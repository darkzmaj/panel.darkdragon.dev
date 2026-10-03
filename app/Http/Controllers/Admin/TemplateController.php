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
use Pterodactyl\Services\Templates\TemplateService;
use Pterodactyl\Services\Templates\TemplateFileStore;
use Pterodactyl\Services\Templates\TemplateInstanceService;

class TemplateController extends Controller
{
    public function __construct(
        private AlertsMessageBag $alert,
        private TemplateService $templates,
        private TemplateFileStore $files,
        private TemplateInstanceService $instances,
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

    /* ---- Files (JSON, used by the editor on the Files tab) ---- */

    public function files(ServerTemplate $template): JsonResponse
    {
        return new JsonResponse(['data' => $template->files->map(fn ($f) => ['path' => $f->path, 'size' => $f->size])->values()]);
    }

    /**
     * @throws DisplayException
     */
    public function readFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $path = $this->files->normalizePath((string) $request->query('path'));
        $file = $template->files()->where('path', $path)->first();
        if (!$file) {
            throw new DisplayException('That file does not exist in this template.');
        }

        return new JsonResponse(['path' => $file->path, 'content' => $this->files->readFile($file)]);
    }

    /**
     * @throws DisplayException
     */
    public function writeFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $data = $request->validate(['path' => 'required|string|max:255', 'content' => 'present|nullable|string']);
        $file = $this->templates->putFile($template, $data['path'], $data['content'] ?? '');

        return new JsonResponse(['path' => $file->path, 'size' => $file->size, 'revision' => $template->refresh()->revision]);
    }

    /**
     * @throws DisplayException
     */
    public function deleteFile(Request $request, ServerTemplate $template): JsonResponse
    {
        $this->templates->deleteFile($template, (string) $request->input('path'));

        return new JsonResponse(['revision' => $template->refresh()->revision]);
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
