<?php

namespace Pterodactyl\Services\Templates;

use Carbon\CarbonImmutable;
use Illuminate\Support\Arr;
use Pterodactyl\Models\Egg;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\EggVariable;
use Illuminate\Support\Facades\Cache;
use Pterodactyl\Models\TemplateInstance;
use Pterodactyl\Exceptions\DisplayException;
use Illuminate\Validation\ValidationException;
use Pterodactyl\Services\Servers\ServerCreationService;
use Pterodactyl\Services\Servers\ServerDeletionService;
use Pterodactyl\Repositories\Wings\DaemonFileRepository;
use Pterodactyl\Repositories\Wings\DaemonPowerRepository;
use Pterodactyl\Repositories\Wings\DaemonServerRepository;
use Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException;

/**
 * The provisioning pipeline for template instances. Each call to advance() performs exactly one step and
 * records the new state, so a step can be repeated or resumed after a crash without redoing earlier work:
 *
 *   queued -> allocating -> creating -> installing -> deploying_files -> (starting) -> ready
 *
 * Servers are always created through ServerCreationService, never by inserting rows directly, and everything
 * that goes into the creation comes from the stored template revision, never from the request.
 */
class TemplateProvisioningService
{
    /** How long a server may stay in the "installing" state before the instance is failed. */
    public const INSTALL_TIMEOUT_SECONDS = 900;
    public const POLL_SECONDS = 5;

    /** Files up to this size are sent from memory; larger ones are streamed. */
    public const INLINE_BYTES = 4 * 1024 * 1024;

    public function __construct(
        private TemplateService $templates,
        private TemplateFileStore $files,
        private TemplatePlacementService $placement,
        private ServerCreationService $creation,
        private ServerDeletionService $deletion,
        private DaemonServerRepository $daemonServer,
        private DaemonFileRepository $daemonFiles,
        private DaemonPowerRepository $daemonPower,
    ) {
    }

    /**
     * Performs the next step. Returns the number of seconds to wait before calling again, or null when the
     * instance reached a final state.
     */
    public function advance(TemplateInstance $instance): ?int
    {
        $instance->refresh();
        if ($instance->isFinished()) {
            return null;
        }

        try {
            return match ($instance->state) {
                TemplateInstance::STATE_QUEUED => $this->begin($instance),
                TemplateInstance::STATE_ALLOCATING => $this->allocateAndCreate($instance),
                TemplateInstance::STATE_CREATING, TemplateInstance::STATE_INSTALLING => $this->awaitInstall($instance),
                TemplateInstance::STATE_DEPLOYING_FILES => $this->deployFiles($instance),
                TemplateInstance::STATE_STARTING => $this->start($instance),
                default => null,
            };
        } catch (\Throwable $exception) {
            $this->fail($instance, $exception);

            return null;
        }
    }

    /**
     * Marks an instance failed, records where and why (without leaking internals), and removes anything the
     * attempt left behind so a retry starts from a clean slate.
     */
    public function fail(TemplateInstance $instance, \Throwable $exception): void
    {
        $stage = $instance->state;
        if (!$exception instanceof DisplayException && !$exception instanceof ValidationException) {
            report($exception);
        }

        $this->cleanup($instance);

        $instance->forceFill([
            'state' => TemplateInstance::STATE_FAILED,
            'failed_stage' => $stage === TemplateInstance::STATE_FAILED ? $instance->failed_stage : $stage,
            'error' => $this->sanitize($exception),
            'state_changed_at' => CarbonImmutable::now(),
        ])->save();
    }

    public function sanitize(\Throwable $exception): string
    {
        if ($exception instanceof ValidationException) {
            return mb_substr(collect($exception->errors())->flatten()->first() ?? 'The template values are invalid.', 0, 480);
        }
        if ($exception instanceof DaemonConnectionException) {
            return 'The node could not be reached or rejected the request.';
        }
        if ($exception instanceof DisplayException) {
            return mb_substr($exception->getMessage(), 0, 480);
        }

        return 'An unexpected error occurred. Check the Panel logs for details.';
    }

    /**
     * Deletes a half-created server. Allocations are released by the deletion itself, and the instance stops
     * pointing at the removed server.
     */
    private function cleanup(TemplateInstance $instance): void
    {
        if (!$instance->server_id) {
            return;
        }

        $server = Server::query()->find($instance->server_id);
        if ($server) {
            try {
                $this->deletion->withForce()->handle($server);
            } catch (\Throwable $exception) {
                report($exception);
            }
        }
        $instance->server_id = null;
        $instance->node_id = null;
    }

    private function transition(TemplateInstance $instance, string $state): void
    {
        $instance->forceFill(['state' => $state, 'state_changed_at' => CarbonImmutable::now()])->save();
    }

    private function begin(TemplateInstance $instance): int
    {
        if (!$this->templates->revision($instance->template, $instance->template_revision)) {
            throw new DisplayException('The template revision for this instance no longer exists.');
        }
        $this->transition($instance, TemplateInstance::STATE_ALLOCATING);

        return 0;
    }

    private function snapshot(TemplateInstance $instance): array
    {
        $revision = $this->templates->revision($instance->template, $instance->template_revision);
        if (!$revision) {
            throw new DisplayException('The template revision for this instance no longer exists.');
        }

        return $revision->snapshot;
    }

    private function allocateAndCreate(TemplateInstance $instance): int
    {
        $snapshot = $this->snapshot($instance);
        $settings = $snapshot['settings'];

        if (!$instance->template->enabled) {
            throw new DisplayException('This template has been disabled.');
        }

        // Placement and creation share one lock: two instances must never be handed the same allocation.
        $lock = Cache::lock('template-placement', 120);
        $lock->block(30);
        try {
            $placed = $this->placement->place($instance->template_id, $snapshot, $instance->id);
            $instance->forceFill(['node_id' => $placed['node']->id])->save();
            $this->transition($instance, TemplateInstance::STATE_CREATING);

            $egg = Egg::query()->findOrFail($settings['egg_id']);
            $server = $this->creation->handle($this->creationData($instance, $snapshot, $egg, $placed));
        } finally {
            $lock->release();
        }

        Server::query()->whereKey($server->id)->update([
            'template_id' => $instance->template_id,
            'template_revision' => $instance->template_revision,
        ]);

        $instance->forceFill(['server_id' => $server->id])->save();
        $this->transition($instance, TemplateInstance::STATE_INSTALLING);

        return self::POLL_SECONDS;
    }

    /**
     * Everything the new server is created from. Note the absence of anything request supplied other than the
     * validated name, owner, description and the overrides the template explicitly allows.
     *
     * @param array{node: \Pterodactyl\Models\Node, allocation_id: int, additional: int[]} $placed
     *
     * @return array<string, mixed>
     */
    private function creationData(TemplateInstance $instance, array $snapshot, Egg $egg, array $placed): array
    {
        $settings = $snapshot['settings'];

        $environment = EggVariable::query()->where('egg_id', $egg->id)->pluck('default_value', 'env_variable')->all();
        $overridable = [];
        foreach ($snapshot['variables'] as $variable) {
            if ($variable['env'] === null) {
                continue;
            }
            if ($variable['value'] !== null) {
                $environment[$variable['env']] = $variable['value'];
            }
            if ($variable['overridable']) {
                $overridable[$variable['env']] = true;
            }
        }
        foreach (Arr::get($instance->overrides ?? [], 'environment', []) as $env => $value) {
            if (isset($overridable[$env])) {
                $environment[$env] = $value;
            }
        }

        return [
            'name' => $instance->name,
            'description' => Arr::get($instance->overrides ?? [], 'description', '') ?? '',
            'owner_id' => $instance->owner_id,
            'node_id' => $placed['node']->id,
            'allocation_id' => $placed['allocation_id'],
            'allocation_additional' => $placed['additional'],
            'nest_id' => $settings['nest_id'],
            'egg_id' => $settings['egg_id'],
            'image' => $settings['docker_image'],
            'startup' => $settings['startup'] ?: $egg->startup,
            'environment' => $environment,
            'memory' => $settings['memory'],
            'swap' => $settings['swap'],
            'disk' => $settings['disk'],
            'io' => $settings['io'],
            'cpu' => $settings['cpu'],
            'oom_disabled' => $settings['oom_disabled'],
            'database_limit' => $settings['database_limit'] ?? 0,
            'allocation_limit' => $settings['allocation_limit'] ?? 0,
            'backup_limit' => $settings['backup_limit'] ?? 0,
            'skip_scripts' => false,
            // The pipeline starts the server itself, after the template files are in place.
            'start_on_completion' => false,
        ];
    }

    private function awaitInstall(TemplateInstance $instance): int
    {
        $server = Server::query()->find($instance->server_id);
        if (!$server) {
            throw new DisplayException('The server disappeared while it was being installed.');
        }

        if ($server->status === Server::STATUS_INSTALL_FAILED) {
            throw new DisplayException('The server installation failed.');
        }
        if ($server->status === null) {
            $this->transition($instance, TemplateInstance::STATE_DEPLOYING_FILES);

            return 0;
        }

        $since = $instance->state_changed_at ?? $instance->updated_at;
        if ($since && $since->diffInSeconds(CarbonImmutable::now(), true) > self::INSTALL_TIMEOUT_SECONDS) {
            throw new DisplayException('The server installation timed out.');
        }

        return self::POLL_SECONDS;
    }

    private function deployFiles(TemplateInstance $instance): int
    {
        $snapshot = $this->snapshot($instance);
        $server = Server::query()->findOrFail($instance->server_id);
        $this->daemonFiles->setServer($server);

        $created = [];
        foreach ($snapshot['files'] as $file) {
            $path = $this->files->normalizePath($file['path']);
            // Small files are sent as text; anything larger is streamed from the stored blob.
            $blob = $this->files->blobPath($instance->template, $file['sha256']);
            $stream = null;
            if ($file['size'] <= self::INLINE_BYTES) {
                $content = $this->files->read($instance->template, $file['sha256']);
            } else {
                $stream = fopen($blob, 'rb');
                $content = $stream;
            }

            $parent = '/';
            $segments = explode('/', $path);
            $name = array_pop($segments);
            foreach ($segments as $segment) {
                $directory = rtrim($parent, '/') . '/' . $segment;
                if (!isset($created[$directory])) {
                    $this->daemonFiles->createDirectory($segment, $parent);
                    $created[$directory] = true;
                }
                $parent = $directory;
            }

            try {
                $this->daemonFiles->putContent(rtrim($parent, '/') . '/' . $name, $content);
            } finally {
                if (is_resource($stream)) {
                    fclose($stream);
                }
            }
        }

        // Health check: the node must still know the server before it is declared usable.
        $this->daemonServer->setServer($server)->getDetails();

        if ($snapshot['settings']['start_automatically']) {
            $this->transition($instance, TemplateInstance::STATE_STARTING);

            return 0;
        }

        $this->markReady($instance);

        return 0;
    }

    private function start(TemplateInstance $instance): int
    {
        $server = Server::query()->findOrFail($instance->server_id);
        $this->daemonPower->setServer($server)->send('start');
        $this->markReady($instance);

        return 0;
    }

    private function markReady(TemplateInstance $instance): void
    {
        $settings = $this->snapshot($instance)['settings'];
        $instance->forceFill([
            'state' => TemplateInstance::STATE_READY,
            'state_changed_at' => CarbonImmutable::now(),
            'error' => null,
            'failed_stage' => null,
            'expires_at' => $settings['temporary'] && $settings['ttl_minutes']
                ? CarbonImmutable::now()->addMinutes($settings['ttl_minutes'])
                : null,
        ])->save();
    }
}
