<?php

declare(strict_types=1);

namespace GobiaTemplates\Http\Controllers;

use GobiaTemplates\Models\ServerTemplate;
use GobiaTemplates\Models\TemplateInstance;
use GobiaTemplates\Services\TemplateInstanceService;
use GobiaTemplates\Services\TemplateNameService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;
use Pterodactyl\Models\EggVariable;
use Pterodactyl\Models\User;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/** The "Create instance, from a template" flow of the dashboard. Administrators only, checked on every call. */
#[Group('Gobia templates')]
class TemplateBrowserController
{
    private const array ALLOWED_FIELDS = ['name', 'owner_id', 'description', 'environment'];

    public function __construct(private readonly TemplateInstanceService $instances, private readonly TemplateNameService $names) {}

    private function admin(Request $request): User
    {
        $user = $request->user();
        throw_unless($user instanceof User && $user->root_admin, AccessDeniedHttpException::class, 'Only administrators can create instances from templates.');

        return $user;
    }

    #[Endpoint('Browse enabled templates')]
    public function index(Request $request): JsonResponse
    {
        $this->admin($request);
        $templates = ServerTemplate::query()
            ->with(['egg.tags', 'node:id,name', 'location:id,short'])
            ->withCount(['instances as instances_count' => fn ($query) => $query->where('state', '!=', TemplateInstance::STATE_FAILED)])
            ->withCount('files')
            ->withSum('files as files_size', 'size')
            ->where('enabled', true)
            ->orderBy('name')
            ->get();

        return new JsonResponse(['data' => $templates->map(fn (ServerTemplate $template): array => $this->summary($template))->values()->all()]);
    }

    #[Endpoint('Template confirmation details', 'The proposed name, what will be created and which values may be overridden.')]
    public function show(Request $request, ServerTemplate $template): JsonResponse
    {
        $this->admin($request);
        $template->load(['egg.tags', 'node:id,name', 'location:id,short', 'allowedNodes:id,name', 'variables']);
        $template->loadCount('files');
        $template->loadSum('files as files_size', 'size');
        $variables = EggVariable::query()->whereIn('id', $template->variables->where('overridable', true)->pluck('egg_variable_id'))->get();

        return new JsonResponse($this->summary($template) + [
            'proposed_name' => $this->names->expand($template->name),
            'description' => $template->description,
            'allowed_nodes' => $template->allowedNodes->pluck('name')->values()->all(),
            'overridable' => $variables->map(function (EggVariable $variable) use ($template): array {
                $set = $template->variables->firstWhere('egg_variable_id', $variable->id);

                return ['env' => $variable->env_variable, 'name' => $variable->name, 'description' => $variable->description, 'value' => $set->value ?? $variable->default_value];
            })->values()->all(),
            'files' => $template->files()->get(['path', 'size'])->map(fn ($file): array => ['path' => $file->path, 'size' => $file->size])->values()->all(),
        ]);
    }

    #[Endpoint('Create an instance from a template', 'Queues provisioning; poll the returned id. Send an Idempotency-Key header to make retries safe.')]
    public function store(Request $request, ServerTemplate $template): JsonResponse
    {
        $user = $this->admin($request);
        $unknown = array_diff(array_keys($request->all()), self::ALLOWED_FIELDS);
        if ($unknown !== []) {
            throw ValidationException::withMessages(collect($unknown)->mapWithKeys(fn ($field): array => [$field => 'This field is not accepted.'])->all());
        }

        $input = $request->only(self::ALLOWED_FIELDS);
        $input['owner_id'] ??= $user->id;
        [$instance] = $this->instances->request($template, $input, null, $request->header('Idempotency-Key'));

        return new JsonResponse($this->instance($instance), 202);
    }

    #[Endpoint('Provisioning status')]
    public function status(Request $request, ServerTemplate $template, string $instance): JsonResponse
    {
        $this->admin($request);
        $row = TemplateInstance::query()->where(['uuid' => $instance, 'template_id' => $template->id])->with('server')->firstOrFail();

        return new JsonResponse($this->instance($row));
    }

    #[Endpoint('Find owners', 'Looks up users to own a new instance.')]
    public function owners(Request $request): JsonResponse
    {
        $this->admin($request);
        $request->validate(['q' => 'nullable|string|max:100']);
        $q = (string) $request->query('q', '');

        $users = User::query()
            ->when($q !== '', function ($query) use ($q): void {
                $like = '%'.addcslashes($q, '%_\\').'%';
                $query->where(fn ($where) => $where->where('username', 'like', $like)->orWhere('email', 'like', $like));
            })
            ->orderBy('username')->limit(20)->get(['id', 'username', 'email']);

        return new JsonResponse(['data' => $users->map(fn (User $user): array => ['id' => $user->id, 'username' => $user->username, 'email' => $user->email])->values()->all()]);
    }

    /** @return array<string, mixed> */
    private function summary(ServerTemplate $template): array
    {
        $placement = match ($template->placement_mode) {
            ServerTemplate::PLACEMENT_FIXED => 'Fixed node'.($template->node ? ': '.$template->node->name : ''),
            ServerTemplate::PLACEMENT_ALLOWED => 'Selected nodes',
            default => 'Any compatible node',
        };
        $eggTags = $template->egg->tags->pluck('name')->all();

        return [
            'id' => $template->id,
            'name' => $template->name,
            'slug' => $template->slug,
            'description' => $template->description,
            'enabled' => $template->enabled,
            'revision' => $template->revision,
            'software' => $template->egg->name,
            'memory' => $template->memory,
            'cpu' => $template->cpu,
            'disk' => $template->disk,
            'placement' => $placement,
            'location' => $template->location?->short,
            'lifecycle' => ['start_automatically' => $template->start_automatically, 'temporary' => $template->temporary, 'ttl_minutes' => $template->ttl_minutes],
            'tags' => array_values(array_filter([...$eggTags, $template->temporary ? 'Temporary' : 'Persistent', $template->start_automatically ? 'Auto start' : null])),
            'instances_count' => (int) ($template->getAttribute('instances_count') ?? 0),
            'files_count' => (int) ($template->getAttribute('files_count') ?? 0),
            'files_size' => (int) ($template->getAttribute('files_size') ?? 0),
        ];
    }

    /** @return array<string, mixed> */
    private function instance(TemplateInstance $instance): array
    {
        return [
            'id' => $instance->uuid,
            'name' => $instance->name,
            'state' => $instance->state,
            'finished' => $instance->isFinished(),
            'failed_stage' => $instance->failed_stage,
            'error' => $instance->error,
            'server' => $instance->server && $instance->state === TemplateInstance::STATE_READY ? $instance->server->uuidShort : null,
        ];
    }
}
