<?php

namespace Pterodactyl\Http\Controllers\Admin;

use Illuminate\View\View;
use Illuminate\Http\Request;
use Pterodactyl\Models\Nest;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\Location;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Prologue\Alerts\AlertsMessageBag;
use Pterodactyl\Models\ServerTemplate;
use Pterodactyl\Models\TemplateInstance;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Models\TemplateSftpCredential;
use Pterodactyl\Services\Templates\TemplateService;
use Pterodactyl\Services\Templates\TemplateFileStore;
use Pterodactyl\Services\Templates\TemplateSftpService;
use Pterodactyl\Services\Templates\TemplateInstanceService;

class TemplateController extends Controller
{
    public function __construct(
        private AlertsMessageBag $alert,
        private TemplateService $templates,
        private TemplateFileStore $files,
        private TemplateInstanceService $instances,
        private TemplateSftpService $sftp,
    ) {
    }

    public function index(): View
    {
        return view('admin.templates.index', [
            'templates' => ServerTemplate::query()
                ->with('egg:id,name')
                ->withCount(['instances as instances_count' => fn ($q) => $q->where('state', '!=', TemplateInstance::STATE_FAILED), 'servers'])
                ->orderBy('name')
                ->get(),
        ]);
    }

    public function create(): View
    {
        return view('admin.templates.form', $this->formData(new ServerTemplate([
            'placement_mode' => ServerTemplate::PLACEMENT_ANY,
            'enabled' => true,
            'swap' => 0,
            'cpu' => 0,
            'io' => 500,
            'oom_disabled' => true,
            'database_limit' => 0,
            'allocation_limit' => 0,
            'backup_limit' => 0,
            'additional_allocations' => 0,
            'start_automatically' => true,
            'allow_instance_delete' => true,
        ])));
    }

    /**
     * @throws \Throwable
     */
    public function store(Request $request): RedirectResponse
    {
        $template = $this->templates->create($request->all());
        $this->alert->success('The template was created. You can now add files to it.')->flash();

        return redirect()->route('admin.templates.view', $template->id);
    }

    public function view(ServerTemplate $template): View
    {
        return view('admin.templates.form', $this->formData($template));
    }

    /**
     * @throws \Throwable
     */
    public function update(Request $request, ServerTemplate $template): RedirectResponse
    {
        $before = $template->revision;
        $template = $this->templates->update($template, $request->all());
        $this->alert->success($template->revision > $before
            ? "The template was saved as revision {$template->revision}. Existing servers are not changed."
            : 'Nothing changed, so no new revision was created.')->flash();

        return redirect()->route('admin.templates.view', $template->id);
    }

    /**
     * @throws \Throwable
     */
    public function duplicate(ServerTemplate $template): RedirectResponse
    {
        $copy = $this->templates->duplicate($template);
        $this->alert->success('The template was duplicated. The copy is disabled until you enable it.')->flash();

        return redirect()->route('admin.templates.view', $copy->id);
    }

    public function toggle(ServerTemplate $template): RedirectResponse
    {
        $this->templates->setEnabled($template, !$template->enabled);
        $this->alert->success($template->enabled ? 'The template is now enabled.' : 'The template is now disabled.')->flash();

        return redirect()->route('admin.templates.view', $template->id);
    }

    public function delete(ServerTemplate $template): RedirectResponse
    {
        try {
            $this->templates->delete($template);
        } catch (DisplayException $exception) {
            $this->alert->danger($exception->getMessage())->flash();

            return redirect()->route('admin.templates.view', $template->id);
        }

        $this->alert->success('The template was deleted.')->flash();

        return redirect()->route('admin.templates');
    }

    /* ---- Files (JSON, used by the editor on the Files tab). They work on the working tree; publish() makes a revision. ---- */

    public function files(ServerTemplate $template): JsonResponse
    {
        $status = $this->templates->workingStatus($template);

        return new JsonResponse([
            'data' => array_map(fn ($e) => ['path' => $e['path'], 'size' => $e['size'], 'type' => $e['type'], 'modified' => $e['modified']], $status['working']),
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

    /**
     * @throws DisplayException
     */
    public function readFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $path = $this->files->normalizePath((string) $request->query('path'));
        $absolute = $this->files->resolve($template, $path);
        if (!is_file($absolute)) {
            throw new DisplayException('That file does not exist in this template.');
        }
        $size = filesize($absolute);
        if ($size > $this->files->limits()['max_edit_bytes']) {
            throw new DisplayException('This file is ' . $this->files->human($size) . ' and is too large to edit in the browser. Download or replace it instead.');
        }
        $content = (string) file_get_contents($absolute);
        if (str_contains($content, "\0") || !mb_check_encoding($content, 'UTF-8')) {
            return new JsonResponse(['path' => $path, 'binary' => true, 'size' => $size]);
        }

        return new JsonResponse(['path' => $path, 'binary' => false, 'size' => $size, 'content' => $content]);
    }

    /**
     * @throws DisplayException
     */
    public function writeFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $data = $request->validate(['path' => 'required|string|max:255', 'content' => 'present|nullable|string']);
        $this->templates->putFile($template, $data['path'], $data['content'] ?? '');

        return new JsonResponse(['path' => $this->files->normalizePath($data['path']), 'status' => 'saved']);
    }

    /**
     * Receives a file as the raw request body, so size is limited by the template limits and not by PHP's upload settings.
     *
     * @throws DisplayException
     */
    public function uploadFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $stream = $request->getContent(true);
        $declared = $request->header('Content-Length') !== null ? (int) $request->header('Content-Length') : null;
        $size = $this->templates->uploadFile($template, (string) $request->query('path'), $stream, $declared);

        return new JsonResponse(['path' => $this->files->normalizePath((string) $request->query('path')), 'size' => $size]);
    }

    /**
     * @throws DisplayException
     */
    public function makeFolder(Request $request, ServerTemplate $template): JsonResponse
    {
        $data = $request->validate(['path' => 'required|string|max:255']);
        $this->templates->makeFolder($template, $data['path']);

        return new JsonResponse(['path' => $this->files->normalizePath($data['path'])], 201);
    }

    /**
     * @throws DisplayException
     */
    public function moveFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $data = $request->validate(['from' => 'required|string|max:255', 'to' => 'required|string|max:255']);
        $this->templates->moveFile($template, $data['from'], $data['to']);

        return new JsonResponse(['from' => $data['from'], 'to' => $data['to']]);
    }

    /**
     * @throws DisplayException
     */
    public function deleteFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $this->templates->deleteFile($template, (string) $request->input('path'));

        return new JsonResponse(['status' => 'deleted']);
    }

    /**
     * @throws DisplayException
     */
    public function downloadFile(Request $request, ServerTemplate $template): \Symfony\Component\HttpFoundation\BinaryFileResponse
    {
        $absolute = $this->files->resolve($template, (string) $request->query('path'));
        if (!is_file($absolute)) {
            throw new DisplayException('That file does not exist in this template.');
        }

        return response()->download($absolute, basename($absolute));
    }

    /**
     * @throws DisplayException
     */
    public function publish(ServerTemplate $template): JsonResponse
    {
        $before = $template->revision;
        $template = $this->templates->publish($template);

        return new JsonResponse(['revision' => $template->revision, 'created_revision' => $template->revision > $before]);
    }

    /* ---- SFTP credentials ---- */

    public function sftp(Request $request, ServerTemplate $template): JsonResponse
    {
        $configured = (string) config('gobia_templates.sftp.service_token') !== '';

        return new JsonResponse([
            'enabled' => $configured,
            'host' => config('gobia_templates.sftp.host') ?: $request->getHost(),
            'port' => (int) config('gobia_templates.sftp.port'),
            'max_days' => (int) config('gobia_templates.sftp.max_credential_days'),
            'credentials' => $template->sftpCredentials()->get()->map(fn (TemplateSftpCredential $c) => [
                'id' => $c->id,
                'label' => $c->label,
                'username' => $c->username,
                'permission' => $c->permission,
                'status' => $c->status(),
                'created_at' => $c->created_at?->toIso8601String(),
                'expires_at' => $c->expires_at?->toIso8601String(),
                'last_used_at' => $c->last_used_at?->toIso8601String(),
                'last_used_ip' => $c->last_used_ip,
            ])->values(),
            'events' => \Illuminate\Support\Facades\DB::table('template_sftp_events')
                ->where('template_id', $template->id)->orderByDesc('id')->limit(15)
                ->get(['event', 'username', 'ip', 'detail', 'created_at']),
        ]);
    }

    /**
     * The secret is in this response and nowhere else, ever again.
     *
     * @throws DisplayException
     */
    public function createSftp(Request $request, ServerTemplate $template): JsonResponse
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

    public function revokeSftp(ServerTemplate $template, TemplateSftpCredential $credential): JsonResponse
    {
        abort_unless($credential->template_id === $template->id, 404);
        $this->sftp->revoke($credential);

        return new JsonResponse(['status' => 'revoked']);
    }

    /* ---- Instances ---- */

    /**
     * @throws \Throwable
     */
    public function createInstance(Request $request, ServerTemplate $template): RedirectResponse
    {
        [$instance] = $this->instances->request($template, $request->only(['name', 'owner_id', 'description', 'environment']));
        $this->alert->success("Provisioning \"{$instance->name}\" has been queued. Follow its progress below.")->flash();

        return redirect()->route('admin.templates.view', $template->id);
    }

    public function instanceStatus(ServerTemplate $template, TemplateInstance $instance): JsonResponse
    {
        abort_unless($instance->template_id === $template->id, 404);

        return new JsonResponse([
            'id' => $instance->uuid,
            'state' => $instance->state,
            'failed_stage' => $instance->failed_stage,
            'error' => $instance->error,
            'server_id' => $instance->server_id,
            'finished' => $instance->isFinished(),
        ]);
    }

    /**
     * @throws DisplayException
     */
    public function retryInstance(ServerTemplate $template, TemplateInstance $instance): RedirectResponse
    {
        abort_unless($instance->template_id === $template->id, 404);
        $this->instances->retry($instance);
        $this->alert->success('The instance was queued again.')->flash();

        return redirect()->route('admin.templates.view', $template->id);
    }

    /**
     * @return array<string, mixed>
     */
    private function formData(ServerTemplate $template): array
    {
        $nests = Nest::query()->with(['eggs' => fn ($q) => $q->orderBy('name'), 'eggs.variables'])->orderBy('name')->get();
        // A plain array the editor script can consume: nests -> eggs -> images and variables.
        $catalog = [];
        foreach ($nests as $nest) {
            $eggs = [];
            foreach ($nest->eggs as $egg) {
                $variables = [];
                foreach ($egg->variables as $variable) {
                    $variables[] = ['env' => $variable->env_variable, 'name' => $variable->name, 'default' => $variable->default_value, 'rules' => $variable->rules];
                }
                $eggs[] = ['id' => $egg->id, 'name' => $egg->name, 'images' => array_values($egg->docker_images ?? []), 'startup' => $egg->startup, 'variables' => $variables];
            }
            $catalog[] = ['id' => $nest->id, 'name' => $nest->name, 'eggs' => $eggs];
        }

        $stored = [];
        $names = [];
        if ($template->exists) {
            $names = \Pterodactyl\Models\EggVariable::query()->where('egg_id', $template->egg_id)->pluck('env_variable', 'id');
            foreach ($template->variables as $variable) {
                $stored[$names[$variable->egg_variable_id] ?? ''] = ['value' => $variable->value, 'overridable' => $variable->overridable];
            }
        }

        return [
            'template' => $template,
            'catalog' => $catalog,
            'storedVariables' => $stored,
            'allowedNodes' => $template->exists ? $template->allowedNodes()->pluck('nodes.id')->all() : [],
            'nodes' => Node::query()->orderBy('name')->get(['id', 'name', 'location_id']),
            'locations' => Location::query()->orderBy('short')->get(['id', 'short']),
            'instances' => $template->exists
                ? $template->instances()->with('server:id,uuidShort,name')->latest('id')->limit(25)->get()
                : collect(),
            'revisions' => $template->exists ? $template->revisions()->limit(25)->get(['id', 'revision', 'created_at']) : collect(),
            'users' => \Pterodactyl\Models\User::query()->orderBy('username')->limit(500)->get(['id', 'username', 'email']),
        ];
    }
}
