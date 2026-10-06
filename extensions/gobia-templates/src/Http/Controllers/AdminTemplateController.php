<?php

declare(strict_types=1);

namespace GobiaTemplates\Http\Controllers;

use GobiaTemplates\Models\ServerTemplate;
use GobiaTemplates\Models\TemplateInstance;
use GobiaTemplates\Models\TemplateSftpCredential;
use GobiaTemplates\Services\TemplateFileStore;
use GobiaTemplates\Services\TemplateInstanceService;
use GobiaTemplates\Services\TemplateService;
use GobiaTemplates\Services\TemplateSftpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Models\Egg;
use Pterodactyl\Models\EggVariable;
use Pterodactyl\Models\Location;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\User;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/** Administration of server templates (root administrators only, enforced by the route group). */
#[Group('Gobia templates')]
class AdminTemplateController
{
    public function __construct(
        private readonly TemplateService $templates,
        private readonly TemplateFileStore $files,
        private readonly TemplateInstanceService $instances,
        private readonly TemplateSftpService $sftp,
    ) {}

    #[Endpoint('List templates')]
    public function index(): JsonResponse
    {
        $templates = ServerTemplate::query()
            ->with('egg:id,name')
            ->withCount(['instances as instances_count' => fn ($query) => $query->where('state', '!=', TemplateInstance::STATE_FAILED)])
            ->orderBy('name')
            ->get();

        return new JsonResponse(['data' => $templates->map(fn (ServerTemplate $template): array => $this->summary($template))->all()]);
    }

    #[Endpoint('Editor options', 'Eggs with their images and variables, nodes, locations and users the template editor needs.')]
    public function options(): JsonResponse
    {
        $eggs = Egg::query()->with('variables')->orderBy('name')->get()->map(fn (Egg $egg): array => [
            'id' => $egg->id,
            'name' => $egg->name,
            'images' => array_values($egg->docker_images ?? []),
            'startup' => $egg->startup,
            'variables' => $egg->variables->map(fn (EggVariable $variable): array => ['env' => $variable->env_variable, 'name' => $variable->name, 'default' => $variable->default_value, 'rules' => $variable->rules])->all(),
        ])->all();

        return new JsonResponse([
            'eggs' => $eggs,
            'nodes' => Node::query()->orderBy('name')->get(['id', 'name', 'location_id'])->map(fn (Node $node): array => ['id' => $node->id, 'name' => $node->name, 'location_id' => $node->location_id])->all(),
            'locations' => Location::query()->orderBy('short')->get(['id', 'short'])->map(fn (Location $location): array => ['id' => $location->id, 'short' => $location->short])->all(),
            'users' => User::query()->orderBy('username')->limit(500)->get(['id', 'username', 'email'])->map(fn (User $user): array => ['id' => $user->id, 'username' => $user->username, 'email' => $user->email])->all(),
        ]);
    }

    #[Endpoint('Create a template')]
    public function store(Request $request): JsonResponse
    {
        $template = $this->templates->create($request->all());

        return new JsonResponse($this->detail($template), 201);
    }

    #[Endpoint('Show a template')]
    public function show(ServerTemplate $template): JsonResponse
    {
        return new JsonResponse($this->detail($template));
    }

    #[Endpoint('Update a template', 'Saves the template. When the effective content changes a new immutable revision is recorded; existing servers are never changed.')]
    public function update(Request $request, ServerTemplate $template): JsonResponse
    {
        $before = $template->revision;
        $template = $this->templates->update($template, $request->all());

        return new JsonResponse($this->detail($template) + ['created_revision' => $template->revision > $before]);
    }

    #[Endpoint('Duplicate a template', 'Creates a disabled copy.')]
    public function duplicate(ServerTemplate $template): JsonResponse
    {
        return new JsonResponse($this->detail($this->templates->duplicate($template)), 201);
    }

    #[Endpoint('Enable or disable a template')]
    public function toggle(ServerTemplate $template): JsonResponse
    {
        $this->templates->setEnabled($template, ! $template->enabled);

        return new JsonResponse(['enabled' => $template->refresh()->enabled]);
    }

    #[Endpoint('Delete a template')]
    public function destroy(ServerTemplate $template): JsonResponse
    {
        $this->templates->delete($template);

        return new JsonResponse(['status' => 'deleted']);
    }

    /* ---- Files: the working tree. publish() turns it into a revision. ---- */

    #[Endpoint('List working files')]
    public function files(ServerTemplate $template): JsonResponse
    {
        $status = $this->templates->workingStatus($template);

        return new JsonResponse([
            'data' => array_map(fn (array $entry): array => ['path' => $entry['path'], 'size' => $entry['size'], 'type' => $entry['type'], 'modified' => $entry['modified']], $status['working']),
            'status' => [
                'dirty' => $status['dirty'],
                'added' => count($status['added']),
                'modified' => count($status['modified']),
                'deleted' => count($status['deleted']),
                'revision' => $template->revision,
                'published_at' => $template->published_at?->toIso8601String(),
                'working_changed_at' => $template->working_changed_at?->toIso8601String(),
            ],
            'limits' => $this->files->limits(),
        ]);
    }

    #[Endpoint('Read a working file')]
    public function readFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $path = $this->files->normalizePath((string) $request->query('path'));
        $absolute = $this->files->resolve($template, $path);
        if (! is_file($absolute)) {
            throw new DisplayException('That file does not exist in this template.');
        }
        $size = (int) filesize($absolute);
        if ($size > $this->files->limits()['max_edit_bytes']) {
            throw new DisplayException('This file is '.$this->files->human($size).' and is too large to edit in the browser. Download or replace it instead.');
        }
        $content = (string) file_get_contents($absolute);
        if (str_contains($content, "\0") || ! mb_check_encoding($content, 'UTF-8')) {
            return new JsonResponse(['path' => $path, 'binary' => true, 'size' => $size]);
        }

        return new JsonResponse(['path' => $path, 'binary' => false, 'size' => $size, 'content' => $content]);
    }

    #[Endpoint('Write a working file')]
    public function writeFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $data = $request->validate(['path' => 'required|string|max:255', 'content' => 'present|nullable|string']);
        $this->templates->putFile($template, $data['path'], $data['content'] ?? '');

        return new JsonResponse(['path' => $this->files->normalizePath($data['path']), 'status' => 'saved']);
    }

    #[Endpoint('Upload a working file', 'The file is the raw request body, so the limit is the template limit, not PHP\'s upload settings.')]
    public function uploadFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $stream = $request->getContent(true);
        $declared = $request->header('Content-Length') !== null ? (int) $request->header('Content-Length') : null;
        $size = $this->templates->uploadFile($template, (string) $request->query('path'), $stream, $declared);

        return new JsonResponse(['path' => $this->files->normalizePath((string) $request->query('path')), 'size' => $size]);
    }

    #[Endpoint('Create a folder')]
    public function makeFolder(Request $request, ServerTemplate $template): JsonResponse
    {
        $data = $request->validate(['path' => 'required|string|max:255']);
        $this->templates->makeFolder($template, $data['path']);

        return new JsonResponse(['path' => $this->files->normalizePath($data['path'])], 201);
    }

    #[Endpoint('Move or rename a file')]
    public function moveFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $data = $request->validate(['from' => 'required|string|max:255', 'to' => 'required|string|max:255']);
        $this->templates->moveFile($template, $data['from'], $data['to']);

        return new JsonResponse(['from' => $data['from'], 'to' => $data['to']]);
    }

    #[Endpoint('Delete a file or folder')]
    public function deleteFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $this->templates->deleteFile($template, (string) $request->input('path'));

        return new JsonResponse(['status' => 'deleted']);
    }

    #[Endpoint('Download a working file')]
    public function downloadFile(Request $request, ServerTemplate $template): BinaryFileResponse
    {
        $absolute = $this->files->resolve($template, (string) $request->query('path'));
        if (! is_file($absolute)) {
            throw new DisplayException('That file does not exist in this template.');
        }

        return response()->download($absolute, basename($absolute));
    }

    #[Endpoint('Publish the working files', 'Records an immutable revision when anything changed.')]
    public function publish(ServerTemplate $template): JsonResponse
    {
        $before = $template->revision;
        $template = $this->templates->publish($template);

        return new JsonResponse(['revision' => $template->revision, 'created_revision' => $template->revision > $before]);
    }

    /* ---- SFTP credentials ---- */

    #[Endpoint('SFTP credentials')]
    public function sftpIndex(Request $request, ServerTemplate $template): JsonResponse
    {
        return new JsonResponse([
            'enabled' => (string) config('gobia_templates.sftp.service_token') !== '',
            'host' => config('gobia_templates.sftp.host') ?: $request->getHost(),
            'port' => (int) config('gobia_templates.sftp.port'),
            'max_days' => (int) config('gobia_templates.sftp.max_credential_days'),
            'credentials' => $template->sftpCredentials()->get()->map(fn (TemplateSftpCredential $credential): array => [
                'id' => $credential->id,
                'label' => $credential->label,
                'username' => $credential->username,
                'permission' => $credential->permission,
                'status' => $credential->status(),
                'created_at' => $credential->created_at?->toIso8601String(),
                'expires_at' => $credential->expires_at?->toIso8601String(),
                'last_used_at' => $credential->last_used_at?->toIso8601String(),
                'last_used_ip' => $credential->last_used_ip,
            ])->values()->all(),
            'events' => DB::table('gobia_template_sftp_events')->where('template_id', $template->id)->orderByDesc('id')->limit(15)->get(['event', 'username', 'ip', 'detail', 'created_at']),
        ]);
    }

    #[Endpoint('Create SFTP credentials', 'The secret appears in this response and nowhere else.')]
    public function sftpCreate(Request $request, ServerTemplate $template): JsonResponse
    {
        $data = $request->validate([
            'label' => 'nullable|string|max:80',
            'permission' => 'required|in:rw,ro',
            'expires_in_days' => 'nullable|integer|min:1|max:3650',
        ]);

        [$credential, $password] = $this->sftp->create($template, $request->user(), $data['permission'], $data['expires_in_days'] ?? null, $data['label'] ?? null);

        return new JsonResponse([
            'id' => $credential->id,
            'username' => $credential->username,
            'password' => $password,
            'permission' => $credential->permission,
            'host' => config('gobia_templates.sftp.host') ?: $request->getHost(),
            'port' => (int) config('gobia_templates.sftp.port'),
            'expires_at' => $credential->expires_at?->toIso8601String(),
        ], 201);
    }

    #[Endpoint('Revoke SFTP credentials')]
    public function sftpRevoke(ServerTemplate $template, int $credential): JsonResponse
    {
        $row = TemplateSftpCredential::query()->where(['id' => $credential, 'template_id' => $template->id])->firstOrFail();
        $this->sftp->revoke($row);

        return new JsonResponse(['status' => 'revoked']);
    }

    /* ---- Instances ---- */

    #[Endpoint('Create an instance from a template')]
    public function instanceStore(Request $request, ServerTemplate $template): JsonResponse
    {
        [$instance] = $this->instances->request($template, $request->only(['name', 'owner_id', 'description', 'environment']));

        return new JsonResponse($this->instanceStatusPayload($instance), 202);
    }

    #[Endpoint('Instance provisioning status')]
    public function instanceStatus(ServerTemplate $template, string $instance): JsonResponse
    {
        return new JsonResponse($this->instanceStatusPayload($this->instanceOf($template, $instance)));
    }

    #[Endpoint('Retry a failed instance')]
    public function instanceRetry(ServerTemplate $template, string $instance): JsonResponse
    {
        return new JsonResponse($this->instanceStatusPayload($this->instances->retry($this->instanceOf($template, $instance))), 202);
    }

    private function instanceOf(ServerTemplate $template, string $uuid): TemplateInstance
    {
        return TemplateInstance::query()->where(['uuid' => $uuid, 'template_id' => $template->id])->firstOrFail();
    }

    /** @return array<string, mixed> */
    private function instanceStatusPayload(TemplateInstance $instance): array
    {
        return [
            'id' => $instance->uuid,
            'state' => $instance->state,
            'failed_stage' => $instance->failed_stage,
            'error' => $instance->error,
            'server_id' => $instance->server_id,
            'finished' => $instance->isFinished(),
        ];
    }

    /** @return array<string, mixed> */
    private function summary(ServerTemplate $template): array
    {
        return [
            'id' => $template->id,
            'uuid' => $template->uuid,
            'name' => $template->name,
            'slug' => $template->slug,
            'description' => $template->description,
            'enabled' => $template->enabled,
            'api_enabled' => $template->api_enabled,
            'revision' => $template->revision,
            'egg' => $template->egg === null ? null : ['id' => $template->egg->id, 'name' => $template->egg->name],
            'memory' => $template->memory,
            'disk' => $template->disk,
            'cpu' => $template->cpu,
            'placement_mode' => $template->placement_mode,
            'temporary' => $template->temporary,
            'instances' => (int) ($template->getAttributes()['instances_count'] ?? 0),
            'published_at' => $template->published_at?->toIso8601String(),
        ];
    }

    /** @return array<string, mixed> */
    private function detail(ServerTemplate $template): array
    {
        $template->loadMissing('variables', 'allowedNodes', 'egg');
        $names = EggVariable::query()->where('egg_id', $template->egg_id)->pluck('env_variable', 'id');
        $variables = [];
        foreach ($template->variables as $variable) {
            $variables[$names[$variable->egg_variable_id] ?? ''] = ['value' => $variable->value, 'overridable' => $variable->overridable];
        }

        return [
            'template' => $this->summary($template) + [
                'docker_image' => $template->docker_image,
                'startup' => $template->startup,
                'swap' => $template->swap,
                'io' => $template->io,
                'oom_disabled' => $template->oom_disabled,
                'database_limit' => $template->database_limit,
                'allocation_limit' => $template->allocation_limit,
                'backup_limit' => $template->backup_limit,
                'node_id' => $template->node_id,
                'location_id' => $template->location_id,
                'additional_allocations' => $template->additional_allocations,
                'preferred_ports' => $template->preferred_ports,
                'max_instances' => $template->max_instances,
                'start_automatically' => $template->start_automatically,
                'ttl_minutes' => $template->ttl_minutes,
                'allow_instance_delete' => $template->allow_instance_delete,
                'allowed_nodes' => $template->allowedNodes->pluck('id')->all(),
                'variables' => $variables,
            ],
            'revisions' => $template->revisions()->limit(25)->get(['revision', 'created_at'])->map(fn ($revision): array => ['revision' => $revision->revision, 'created_at' => $revision->created_at?->toIso8601String()])->all(),
            'instances' => $template->instances()->with('server')->latest('id')->limit(25)->get()->map(fn (TemplateInstance $instance): array => $this->instanceStatusPayload($instance) + ['name' => $instance->name, 'created_at' => $instance->created_at?->toIso8601String()])->all(),
        ];
    }
}
