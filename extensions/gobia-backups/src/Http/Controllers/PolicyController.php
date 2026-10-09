<?php

declare(strict_types=1);

namespace GobiaBackups\Http\Controllers;

use Cron\CronExpression;
use GobiaBackups\Models\Policy;
use GobiaBackups\Services\PolicyResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;
use Pterodactyl\Facades\Activity;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\Server;

/**
 * Backup policy levels: one global level, one per node, one per server. A level stores only what it changes;
 * what applies to a server is computed (server over node over global). Administrators only.
 */
#[Group('Gobia backups')]
class PolicyController
{
    public function __construct(private readonly PolicyResolver $resolver) {}

    #[Endpoint('List backup policy levels')]
    public function index(): JsonResponse
    {
        $servers = Server::query()->whereIn('id', Policy::query()->whereNotNull('server_id')->pluck('server_id'))->pluck('uuid', 'id');

        return new JsonResponse([
            'defaults' => Policy::DEFAULTS,
            'data' => Policy::query()->orderBy('scope')->orderBy('id')->get()->map(fn (Policy $policy): array => [
                'scope' => $policy->scope,
                'node_id' => $policy->node_id,
                'server' => $policy->server_id === null ? null : ($servers[$policy->server_id] ?? null),
                'overrides' => (object) $policy->overrides(),
            ])->all(),
        ]);
    }

    #[Endpoint('Policy that applies to a server', 'The result of the global, node and server levels for one server.')]
    public function effective(string $server): JsonResponse
    {
        $model = Server::query()->where('uuid', $server)->firstOrFail();

        return new JsonResponse($this->resolver->effective($model));
    }

    #[Endpoint('Set a backup policy level', 'Replaces what one level overrides. A field that is left out or null is inherited from the level above.')]
    public function put(Request $request): JsonResponse
    {
        $data = $request->validate([
            'scope' => ['required', Rule::in([Policy::SCOPE_GLOBAL, Policy::SCOPE_NODE, Policy::SCOPE_SERVER])],
            'node_id' => ['required_if:scope,node', 'nullable', 'integer'],
            'server' => ['required_if:scope,server', 'nullable', 'uuid'],
            'destination_id' => ['sometimes', 'nullable', 'integer', Rule::exists('gobia_backup_destinations', 'id')],
            'enabled' => ['sometimes', 'nullable', 'boolean'],
            'cron' => ['sometimes', 'nullable', 'string', 'max:64'],
            'timezone' => ['sometimes', 'nullable', 'timezone:all'],
            'window_start' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1439'],
            'window_end' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1439'],
            'keep_last' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:365'],
            'keep_days' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:3650'],
            'ignored' => ['sometimes', 'nullable', 'array', 'max:100'],
            'ignored.*' => ['string', 'max:255'],
            'mirror_user_backups' => ['sometimes', 'nullable', 'boolean'],
        ]);

        if (isset($data['cron']) && ! CronExpression::isValidExpression($data['cron'])) {
            throw ValidationException::withMessages(['cron' => 'This is not a valid cron expression (five fields, for example "0 4 * * *").']);
        }
        if (isset($data['window_start']) !== isset($data['window_end'])) {
            throw ValidationException::withMessages(['window_end' => 'Give both ends of the window, or neither.']);
        }

        $key = ['scope' => $data['scope'], 'node_id' => null, 'server_id' => null];
        if ($data['scope'] === Policy::SCOPE_NODE) {
            $key['node_id'] = Node::query()->findOrFail($data['node_id'])->id;
        } elseif ($data['scope'] === Policy::SCOPE_SERVER) {
            $key['server_id'] = Server::query()->where('uuid', $data['server'])->firstOrFail()->id;
        }

        $fields = [];
        foreach (array_keys(Policy::DEFAULTS) as $field) {
            $fields[$field] = $data[$field] ?? null;
        }

        $policy = Policy::query()->where($key)->first() ?? new Policy($key);
        $policy->fill($fields)->save();
        $this->resolver->forget();
        Activity::event('gobia:backup.policy-updated')->property(['scope' => $data['scope'], 'node_id' => $key['node_id'], 'server' => $data['server'] ?? null, 'overrides' => $policy->overrides()])->log();

        return new JsonResponse(['scope' => $policy->scope, 'overrides' => (object) $policy->overrides()]);
    }

    #[Endpoint('Remove a backup policy level', 'The level then inherits everything again. The global level cannot be removed, only emptied.')]
    public function destroy(Request $request): JsonResponse
    {
        $data = $request->validate([
            'scope' => ['required', Rule::in([Policy::SCOPE_NODE, Policy::SCOPE_SERVER])],
            'node_id' => ['required_if:scope,node', 'nullable', 'integer'],
            'server' => ['required_if:scope,server', 'nullable', 'uuid'],
        ]);

        $query = Policy::query()->where('scope', $data['scope']);
        $data['scope'] === Policy::SCOPE_NODE
            ? $query->where('node_id', $data['node_id'])
            : $query->where('server_id', Server::query()->where('uuid', $data['server'])->toBase()->value('id') ?? 0);
        $query->delete();
        $this->resolver->forget();

        return new JsonResponse([], 204);
    }
}
