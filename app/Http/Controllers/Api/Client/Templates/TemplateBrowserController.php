<?php

namespace Pterodactyl\Http\Controllers\Api\Client\Templates;

use Pterodactyl\Models\User;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Models\EggVariable;
use Pterodactyl\Models\ServerTemplate;
use Pterodactyl\Models\TemplateInstance;
use Pterodactyl\Services\Templates\TemplateNameService;
use Pterodactyl\Services\Templates\TemplateInstanceService;
use Pterodactyl\Http\Controllers\Api\Client\ClientApiController;
use Pterodactyl\Http\Requests\Api\Client\Templates\AdminTemplateRequest;

/**
 * The template browser behind "Create Instance -> Template" in the dashboard. Administrators only.
 */
class TemplateBrowserController extends ClientApiController
{
    private const ALLOWED_FIELDS = ['name', 'owner_id', 'description', 'environment'];

    public function __construct(private TemplateInstanceService $instances, private TemplateNameService $names)
    {
        parent::__construct();
    }

    public function index(AdminTemplateRequest $request): JsonResponse
    {
        $templates = ServerTemplate::query()
            ->with(['egg:id,name', 'nest:id,name', 'node:id,name', 'location:id,short'])
            ->withCount(['instances as instances_count' => fn ($q) => $q->where('state', '!=', TemplateInstance::STATE_FAILED)])
            ->withCount('files')
            ->withSum('files as files_size', 'size')
            ->orderBy('name')
            ->get();

        return new JsonResponse(['data' => $templates->map(fn (ServerTemplate $t) => $this->summary($t))->values()]);
    }

    /**
     * Everything the confirmation screen shows: the proposed name, what will be created and which values may be overridden.
     */
    public function show(AdminTemplateRequest $request, ServerTemplate $template): JsonResponse
    {
        $template->load(['egg:id,name', 'nest:id,name', 'node:id,name', 'location:id,short', 'allowedNodes:id,name', 'variables']);
        $template->loadCount('files');
        $template->loadSum('files as files_size', 'size');

        $variables = EggVariable::query()->whereIn('id', $template->variables->where('overridable', true)->pluck('egg_variable_id'))->get();

        return new JsonResponse($this->summary($template) + [
            'proposed_name' => $this->names->expand($template->name),
            'description' => $template->description,
            'allowed_nodes' => $template->allowedNodes->pluck('name')->values(),
            'overridable' => $variables->map(function (EggVariable $variable) use ($template) {
                $set = $template->variables->firstWhere('egg_variable_id', $variable->id);

                return [
                    'env' => $variable->env_variable,
                    'name' => $variable->name,
                    'description' => $variable->description,
                    'value' => $set?->value ?? $variable->default_value,
                ];
            })->values(),
            'files' => $template->files()->get(['path', 'size'])->map(fn ($f) => ['path' => $f->path, 'size' => $f->size])->values(),
        ]);
    }

    public function store(AdminTemplateRequest $request, ServerTemplate $template): JsonResponse
    {
        $unknown = array_diff(array_keys($request->all()), self::ALLOWED_FIELDS);
        if ($unknown) {
            throw \Illuminate\Validation\ValidationException::withMessages(collect($unknown)->mapWithKeys(fn ($field) => [$field => 'This field is not accepted.'])->all());
        }

        $input = $request->only(self::ALLOWED_FIELDS);
        $input['owner_id'] = $input['owner_id'] ?? $request->user()->id;

        [$instance] = $this->instances->request($template, $input, null, $request->header('Idempotency-Key'));

        return new JsonResponse($this->instance($instance), Response::HTTP_ACCEPTED);
    }

    public function status(AdminTemplateRequest $request, ServerTemplate $template, TemplateInstance $instance): JsonResponse
    {
        abort_unless($instance->template_id === $template->id, 404);

        return new JsonResponse($this->instance($instance->load('server:id,uuidShort,uuid')));
    }

    /**
     * Looks up users to own a new instance.
     */
    public function owners(AdminTemplateRequest $request): JsonResponse
    {
        $request->validate(['q' => 'nullable|string|max:100']);
        $q = (string) $request->query('q', '');

        $users = User::query()
            ->when($q !== '', fn ($query) => $query->where(function ($w) use ($q) {
                $like = '%' . addcslashes($q, '%_\\') . '%';
                $w->where('username', 'like', $like)->orWhere('email', 'like', $like);
            }))
            ->orderBy('username')->limit(20)->get(['id', 'username', 'email']);

        return new JsonResponse(['data' => $users->map(fn (User $u) => ['id' => $u->id, 'username' => $u->username, 'email' => $u->email])->values()]);
    }

    /**
     * @return array<string, mixed>
     */
    private function summary(ServerTemplate $t): array
    {
        $placement = match ($t->placement_mode) {
            ServerTemplate::PLACEMENT_FIXED => 'Fixed node' . ($t->node ? ': ' . $t->node->name : ''),
            ServerTemplate::PLACEMENT_ALLOWED => 'Selected nodes',
            default => 'Any compatible node',
        };

        return [
            'id' => $t->id,
            'name' => $t->name,
            'slug' => $t->slug,
            'description' => $t->description,
            'enabled' => $t->enabled,
            'revision' => $t->revision,
            'software' => $t->egg?->name,
            'nest' => $t->nest?->name,
            'memory' => $t->memory,
            'cpu' => $t->cpu,
            'disk' => $t->disk,
            'placement' => $placement,
            'location' => $t->location?->short,
            'lifecycle' => [
                'start_automatically' => $t->start_automatically,
                'temporary' => $t->temporary,
                'ttl_minutes' => $t->ttl_minutes,
            ],
            'tags' => array_values(array_filter([
                $t->nest?->name,
                $t->egg?->name,
                $t->temporary ? 'Temporary' : 'Persistent',
                $t->start_automatically ? 'Auto-start' : null,
            ])),
            'instances_count' => (int) ($t->instances_count ?? 0),
            'files_count' => (int) ($t->files_count ?? 0),
            'files_size' => (int) ($t->files_size ?? 0),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function instance(TemplateInstance $i): array
    {
        return [
            'id' => $i->uuid,
            'name' => $i->name,
            'state' => $i->state,
            'finished' => $i->isFinished(),
            'failed_stage' => $i->failed_stage,
            'error' => $i->error,
            'server' => $i->server && $i->state === TemplateInstance::STATE_READY ? $i->server->uuidShort : null,
        ];
    }
}
