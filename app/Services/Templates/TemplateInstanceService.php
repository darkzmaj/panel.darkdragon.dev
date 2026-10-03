<?php

namespace Pterodactyl\Services\Templates;

use Ramsey\Uuid\Uuid;
use Illuminate\Support\Arr;
use Pterodactyl\Models\ApiKey;
use Pterodactyl\Models\EggVariable;
use Illuminate\Support\Facades\Cache;
use Pterodactyl\Models\ServerTemplate;
use Pterodactyl\Models\TemplateInstance;
use Pterodactyl\Exceptions\DisplayException;
use Illuminate\Validation\ValidationException;
use Pterodactyl\Jobs\ProvisionTemplateInstanceJob;
use Pterodactyl\Services\Servers\ServerDeletionService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Contracts\Validation\Factory as ValidationFactory;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * Accepts requests to create servers from templates. Only a strict allowlist of values is read from the
 * request: a name, an owner, an optional description, and environment values for the variables the template
 * marks as overridable. Resources, images, startup commands, files and placement can only come from the template.
 */
class TemplateInstanceService
{
    public function __construct(
        private ValidationFactory $validator,
        private ServerDeletionService $deletion,
        private TemplateNameService $names,
    ) {
    }

    /**
     * Validates a request, stores it as a queued instance and dispatches provisioning. Returns the instance and
     * whether it was newly created (false when an identical request with the same idempotency key already existed).
     *
     * @return array{0: TemplateInstance, 1: bool}
     *
     * @throws ValidationException
     * @throws DisplayException
     */
    public function request(ServerTemplate $template, array $input, ?ApiKey $key = null, ?string $idempotencyKey = null): array
    {
        if (!$template->enabled) {
            throw new DisplayException('This template is disabled.');
        }
        if ($idempotencyKey !== null && !preg_match('/^[A-Za-z0-9_\-:.]{1,80}$/', $idempotencyKey)) {
            throw ValidationException::withMessages(['idempotency_key' => 'The idempotency key may only contain letters, numbers and _ - : . (maximum 80 characters).']);
        }

        $data = $this->validate($template, $input);
        $hash = hash('sha256', json_encode([$template->id, $data['name'], $data['owner_id'], $data['description'] ?? null, $this->sorted($data['environment'] ?? [])]));

        if ($idempotencyKey !== null) {
            $existing = $this->findByKey($template, $idempotencyKey);
            if ($existing) {
                return [$this->assertSameRequest($existing, $hash), false];
            }
        }

        // A name containing a placeholder (for example "Hub %number%") is expanded under a lock together with creating the
        // instance, so two requests made at the same moment cannot be handed the same number.
        $lock = $this->names->hasPlaceholders($data['name']) ? Cache::lock('template-instance-name', 15) : null;
        $lock?->block(10);

        try {
            $instance = TemplateInstance::query()->create([
                'uuid' => Uuid::uuid4()->toString(),
                'template_id' => $template->id,
                'template_revision' => $template->revision,
                'owner_id' => $data['owner_id'],
                'api_key_id' => $key?->id,
                'name' => $this->names->expand($data['name']),
                'state' => TemplateInstance::STATE_QUEUED,
                'attempts' => 0,
                'overrides' => array_filter([
                    'description' => $data['description'] ?? null,
                    'environment' => $data['environment'] ?? null,
                ]) ?: null,
                'idempotency_key' => $idempotencyKey,
                'request_hash' => $hash,
                'state_changed_at' => now(),
            ]);
        } catch (UniqueConstraintViolationException) {
            // A concurrent request with the same key won the race.
            return [$this->assertSameRequest($this->findByKey($template, $idempotencyKey), $hash), false];
        } finally {
            $lock?->release();
        }

        ProvisionTemplateInstanceJob::dispatch($instance);

        return [$instance, true];
    }

    /**
     * Puts a failed instance back in the queue. Whatever the failed attempt created was already removed.
     *
     * @throws DisplayException
     */
    public function retry(TemplateInstance $instance): TemplateInstance
    {
        if ($instance->state !== TemplateInstance::STATE_FAILED) {
            throw new DisplayException('Only failed instances can be retried.');
        }
        if ($instance->server_id) {
            throw new DisplayException('This instance still has a server attached and cannot be retried.');
        }

        // A retry builds the server from the revision the instance was requested with, not from newer edits.
        $instance->forceFill([
            'state' => TemplateInstance::STATE_QUEUED,
            'failed_stage' => null,
            'error' => null,
            'attempts' => $instance->attempts + 1,
            'state_changed_at' => now(),
        ])->save();

        ProvisionTemplateInstanceJob::dispatch($instance);

        return $instance;
    }

    /**
     * Deletes the server of an instance, when the template allows that.
     *
     * @throws DisplayException
     */
    public function destroy(TemplateInstance $instance, bool $ignoreTemplateRule = false): void
    {
        if (!$ignoreTemplateRule && !$instance->template->allow_instance_delete) {
            throw new DisplayException('Instances of this template cannot be deleted through the API.');
        }
        if (!$instance->isFinished()) {
            throw new DisplayException('This instance is still being provisioned and cannot be deleted yet.');
        }

        $server = $instance->server;
        if ($server) {
            $this->deletion->handle($server);
        }
        $instance->forceFill(['server_id' => null, 'expires_at' => null])->save();
    }

    /**
     * @return array<string, mixed>
     *
     * @throws ValidationException
     */
    public function validate(ServerTemplate $template, array $input): array
    {
        $data = $this->validator->make($input, [
            'name' => 'required|string|min:1|max:191',
            'owner_id' => 'required|integer|exists:users,id',
            'description' => 'nullable|string|max:255',
            'environment' => 'sometimes|nullable|array|max:200',
            'environment.*' => 'nullable|string|max:4096',
        ])->validate();

        $overridable = $template->variables()->where('overridable', true)->pluck('egg_variable_id');
        $allowed = EggVariable::query()->whereIn('id', $overridable)->get()->keyBy('env_variable');

        $errors = [];
        foreach (Arr::get($data, 'environment', []) ?? [] as $env => $value) {
            $variable = $allowed->get($env);
            if (!$variable) {
                $errors["environment.$env"] = "$env cannot be changed for instances of this template.";
                continue;
            }
            $check = $this->validator->make(['value' => $value], ['value' => $variable->rules]);
            if ($check->fails()) {
                $errors["environment.$env"] = $check->errors()->first('value');
            }
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return $data;
    }

    private function findByKey(ServerTemplate $template, string $key): ?TemplateInstance
    {
        return TemplateInstance::query()->where('template_id', $template->id)->where('idempotency_key', $key)->first();
    }

    private function assertSameRequest(?TemplateInstance $existing, string $hash): TemplateInstance
    {
        if (!$existing || $existing->request_hash !== $hash) {
            throw new ConflictHttpException('This idempotency key was already used with a different request.');
        }

        return $existing;
    }

    /**
     * @param array<string, mixed> $values
     *
     * @return array<string, mixed>
     */
    private function sorted(array $values): array
    {
        ksort($values);

        return $values;
    }
}
