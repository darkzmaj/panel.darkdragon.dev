<?php

namespace GobiaTemplates\Services;

use Ramsey\Uuid\Uuid;
use Illuminate\Support\Str;
use Pterodactyl\Models\Egg;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\EggVariable;
use GobiaTemplates\Models\ServerTemplate;
use GobiaTemplates\Models\TemplateInstance;
use GobiaTemplates\Models\ServerTemplateFile;
use Illuminate\Database\ConnectionInterface;
use Pterodactyl\Exceptions\DisplayException;
use Illuminate\Validation\ValidationException;
use GobiaTemplates\Models\ServerTemplateRevision;
use GobiaTemplates\Models\ServerTemplateVariable;
use Illuminate\Contracts\Validation\Factory as ValidationFactory;

/**
 * Creates and edits server templates and records an immutable revision whenever the effective
 * content of a template changes. Servers remember the revision they were created from; editing a
 * template never touches servers that already exist.
 */
class TemplateService
{
    /** Columns that can be set from user input. Everything else (id, uuid, revision) is system managed. */
    public const SCALAR_FIELDS = [
        'name', 'slug', 'description', 'enabled',
        'egg_id', 'docker_image', 'startup', 'api_enabled',
        'memory', 'swap', 'disk', 'cpu', 'io', 'oom_disabled', 'database_limit', 'allocation_limit', 'backup_limit',
        'placement_mode', 'node_id', 'location_id', 'additional_allocations', 'preferred_ports', 'max_instances',
        'start_automatically', 'temporary', 'ttl_minutes', 'allow_instance_delete',
    ];

    public function __construct(
        private ConnectionInterface $connection,
        private ValidationFactory $validator,
        private TemplateFileStore $files,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(?ServerTemplate $template = null): array
    {
        return [
            'name' => 'required|string|min:1|max:80',
            'slug' => ['sometimes', 'nullable', 'string', 'max:80', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/', 'unique:gobia_server_templates,slug' . ($template ? ',' . $template->id : '')],
            'description' => 'nullable|string|max:500',
            'enabled' => 'sometimes|boolean',
            'api_enabled' => 'sometimes|boolean',
            'egg_id' => 'required|integer|exists:eggs,id',
            'docker_image' => ['required', 'string', 'max:191', 'regex:/^~?[\w\.\/\-:@ ]*$/'],
            'startup' => 'nullable|string|max:4096',
            'memory' => 'required|integer|min:0|max:4194304',
            'swap' => 'required|integer|min:-1|max:4194304',
            'disk' => 'required|integer|min:0|max:67108864',
            'cpu' => 'required|integer|min:0|max:100000',
            'io' => 'required|integer|between:10,1000',
            'oom_disabled' => 'sometimes|boolean',
            'database_limit' => 'nullable|integer|min:0|max:1000',
            'allocation_limit' => 'nullable|integer|min:0|max:1000',
            'backup_limit' => 'nullable|integer|min:0|max:1000',
            'placement_mode' => 'required|in:' . implode(',', [ServerTemplate::PLACEMENT_FIXED, ServerTemplate::PLACEMENT_ALLOWED, ServerTemplate::PLACEMENT_ANY]),
            'node_id' => 'nullable|integer|exists:nodes,id',
            'allowed_nodes' => 'sometimes|array|max:100',
            'allowed_nodes.*' => 'integer|distinct|exists:nodes,id',
            'location_id' => 'nullable|integer|exists:locations,id',
            'additional_allocations' => 'sometimes|integer|min:0|max:50',
            'preferred_ports' => 'nullable|string|max:191',
            'max_instances' => 'nullable|integer|min:1|max:100000',
            'start_automatically' => 'sometimes|boolean',
            'temporary' => 'sometimes|boolean',
            'ttl_minutes' => 'nullable|integer|min:1|max:5256000',
            'allow_instance_delete' => 'sometimes|boolean',
            'variables' => 'sometimes|array|max:200',
            'variables.*.value' => 'nullable|string|max:4096',
            'variables.*.overridable' => 'sometimes|boolean',
        ];
    }

    /**
     * Validates input against the rules plus the cross-field checks that rules cannot express.
     *
     * @return array<string, mixed>
     *
     * @throws ValidationException
     */
    public function validate(array $input, ?ServerTemplate $template = null): array
    {
        $validator = $this->validator->make($input, $this->rules($template));
        $validator->after(function ($validator) use ($input) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $egg = Egg::query()->find($input['egg_id']);
            if (!in_array($input['docker_image'], array_values($egg->docker_images ?? []), true)) {
                $validator->errors()->add('docker_image', 'The Docker image must be one of the images defined by the selected software.');
            }

            $mode = $input['placement_mode'];
            if ($mode === ServerTemplate::PLACEMENT_FIXED && empty($input['node_id'])) {
                $validator->errors()->add('node_id', 'Choose the node this template is fixed to.');
            }
            if ($mode === ServerTemplate::PLACEMENT_ALLOWED && empty($input['allowed_nodes'])) {
                $validator->errors()->add('allowed_nodes', 'Choose at least one allowed node.');
            }
            if (!empty($input['preferred_ports']) && PortSpec::parse($input['preferred_ports']) === null) {
                $validator->errors()->add('preferred_ports', 'Use a comma separated list of ports or ranges, for example 25565,25570-25580.');
            }

            // Variables must belong to the selected software, and the value must satisfy the variable's own rules.
            $known = EggVariable::query()->where('egg_id', $egg->id)->get()->keyBy('env_variable');
            foreach ($input['variables'] ?? [] as $env => $row) {
                $variable = $known->get($env);
                if (!$variable) {
                    $validator->errors()->add("variables.$env", "$env is not a variable of the selected software.");
                    continue;
                }
                if (($row['value'] ?? null) === null || $row['value'] === '') {
                    continue;
                }
                $check = $this->validator->make(['value' => $row['value']], ['value' => $variable->rules]);
                if ($check->fails()) {
                    $validator->errors()->add("variables.$env", $check->errors()->first('value'));
                }
            }
        });

        return $validator->validate();
    }

    /**
     * @throws ValidationException
     * @throws \Throwable
     */
    public function create(array $input): ServerTemplate
    {
        $data = $this->validate($input);

        return $this->connection->transaction(function () use ($data) {
            $template = new ServerTemplate();
            $this->fill($template, $data);
            $template->uuid = Uuid::uuid4()->toString();
            $template->slug = $this->uniqueSlug(!empty($data['slug']) ? $data['slug'] : $data['name']);
            $template->revision = 1;
            $template->save();

            $this->syncRelations($template, $data);
            $this->record($template);

            return $template->refresh();
        });
    }

    /**
     * @throws ValidationException
     * @throws \Throwable
     */
    public function update(ServerTemplate $template, array $input): ServerTemplate
    {
        $data = $this->validate($input, $template);

        return $this->connection->transaction(function () use ($template, $data) {
            $this->fill($template, $data);
            if (!empty($data['slug'])) {
                $template->slug = $data['slug'];
            }
            $template->save();

            $this->syncRelations($template, $data);
            $this->commit($template);

            return $template->refresh();
        });
    }

    public function setEnabled(ServerTemplate $template, bool $enabled): ServerTemplate
    {
        $template->enabled = $enabled;
        $template->save();

        return $template;
    }

    /**
     * Copies a template, including its variables, nodes and files. The copy starts disabled so it
     * cannot be used before somebody has looked at it.
     *
     * @throws \Throwable
     */
    public function duplicate(ServerTemplate $source): ServerTemplate
    {
        return $this->connection->transaction(function () use ($source) {
            $copy = $source->replicate(['uuid', 'slug', 'revision', 'name']);
            $copy->uuid = Uuid::uuid4()->toString();
            $copy->name = Str::limit($source->name, 70, '') . ' (copy)';
            $copy->slug = $this->uniqueSlug($source->slug . '-copy');
            $copy->enabled = false;
            $copy->revision = 1;
            $copy->save();

            $copy->allowedNodes()->sync($source->allowedNodes()->pluck('nodes.id')->all());
            foreach ($source->variables as $variable) {
                ServerTemplateVariable::query()->insert([
                    'template_id' => $copy->id,
                    'egg_variable_id' => $variable->egg_variable_id,
                    'value' => $variable->value,
                    'overridable' => $variable->overridable,
                ]);
            }
            foreach ($source->files as $file) {
                $copy->files()->create(['path' => $file->path, 'size' => $file->size, 'sha256' => $file->sha256]);
            }
            $this->files->copyTemplate($source, $copy);
            $copy->forceFill(['published_at' => $source->published_at])->save();

            $this->record($copy->refresh());

            return $copy;
        });
    }

    /**
     * Deletes an unused template. A template that has created servers or has instance history is kept so
     * those servers keep a meaningful record of where they came from; disable it instead.
     *
     * @throws DisplayException
     */
    public function delete(ServerTemplate $template): void
    {
        if ($template->instances()->exists()) {
            throw new DisplayException('This template has been used to create servers and cannot be deleted. Disable it instead.');
        }

        $this->connection->transaction(function () use ($template) {
            $template->delete();
        });
        $this->files->deleteAll($template);
    }

    /**
     * Saves text into the working tree. Nothing is published, and no revision is created, until publish() is called.
     *
     * @throws DisplayException
     */
    public function putFile(ServerTemplate $template, string $path, string $content): void
    {
        $this->files->writeText($template, $path, $content);
        $this->touchWorkingTree($template);
    }

    /**
     * @param resource $stream
     *
     * @throws DisplayException
     */
    public function uploadFile(ServerTemplate $template, string $path, $stream, ?int $declaredSize = null): int
    {
        $written = $this->files->writeStream($template, $path, $stream, $declaredSize);
        $this->touchWorkingTree($template);

        return $written;
    }

    /**
     * @throws DisplayException
     */
    public function makeFolder(ServerTemplate $template, string $path): void
    {
        $this->files->makeFolder($template, $path);
        $this->touchWorkingTree($template);
    }

    /**
     * Removes a file or folder from the working tree.
     *
     * @throws DisplayException
     */
    public function deleteFile(ServerTemplate $template, string $path): void
    {
        $this->files->remove($template, $path);
        $this->touchWorkingTree($template);
    }

    /**
     * @throws DisplayException
     */
    public function moveFile(ServerTemplate $template, string $from, string $to): void
    {
        $this->files->move($template, $from, $to);
        $this->touchWorkingTree($template);
    }

    /**
     * Records that the working tree changed (the admin page shows this, and SFTP sessions call it when they end).
     */
    public function touchWorkingTree(ServerTemplate $template): void
    {
        $template->forceFill(['working_changed_at' => now()])->save();
    }

    /**
     * What differs between the working tree and the latest published revision.
     *
     * @return array{added: string[], modified: string[], deleted: string[], dirty: bool, working: array<int, array{path: string, size: int, type: string, modified: int}>}
     */
    public function workingStatus(ServerTemplate $template): array
    {
        $working = $this->files->scan($template);
        $published = $template->files()->get()->keyBy('path');
        $publishedAt = $template->published_at->timestamp ?? 0;

        $added = $modified = [];
        $seen = [];
        foreach ($working as $entry) {
            if ($entry['type'] !== 'file') {
                continue;
            }
            $seen[$entry['path']] = true;
            $known = $published->get($entry['path']);
            if (!$known) {
                $added[] = $entry['path'];
            } elseif ($known->size !== $entry['size'] || $entry['modified'] >= $publishedAt) {
                // Same size and not touched since publishing means unchanged; otherwise compare the content.
                $hash = hash_file('sha256', $this->files->resolve($template, $entry['path']));
                if ($hash !== $known->sha256) {
                    $modified[] = $entry['path'];
                }
            }
        }
        $deleted = $published->keys()->reject(fn ($path) => isset($seen[$path]))->values()->all();

        return [
            'added' => $added,
            'modified' => $modified,
            'deleted' => $deleted,
            'dirty' => $added || $modified || $deleted,
            'working' => $working,
        ];
    }

    /**
     * Publishes the working tree: every file is stored as an immutable blob, the published file list is replaced, and a
     * new revision is recorded if anything actually changed. Existing servers are never touched.
     *
     * @throws DisplayException
     */
    public function publish(ServerTemplate $template): ServerTemplate
    {
        $manifest = $this->files->snapshotWorkingTree($template);

        return $this->connection->transaction(function () use ($template, $manifest) {
            $template->files()->delete();
            foreach ($manifest as $file) {
                $template->files()->create($file);
            }
            $template->forceFill(['published_at' => now()])->save();
            $template->unsetRelation('files');
            $this->commit($template->refresh());

            return $template->refresh();
        });
    }

    /**
     * Builds the complete, deterministic description of what a new server will be created from.
     *
     * @return array<string, mixed>
     */
    public function snapshot(ServerTemplate $template): array
    {
        $template->loadMissing(['variables', 'files', 'allowedNodes']);
        $variables = EggVariable::query()->whereIn('id', $template->variables->pluck('egg_variable_id'))->get()->keyBy('id');

        $scalars = [];
        foreach (self::SCALAR_FIELDS as $field) {
            $scalars[$field] = $template->{$field};
        }

        return [
            'settings' => $scalars,
            'allowed_nodes' => $template->allowedNodes->pluck('id')->sort()->values()->all(),
            'variables' => $template->variables
                ->map(fn (ServerTemplateVariable $v) => [
                    'egg_variable_id' => $v->egg_variable_id,
                    'env' => $variables->get($v->egg_variable_id)?->env_variable,
                    'value' => $v->value,
                    'overridable' => $v->overridable,
                ])
                ->sortBy('env')->values()->all(),
            'files' => $template->files
                ->map(fn (ServerTemplateFile $f) => ['path' => $f->path, 'size' => $f->size, 'sha256' => $f->sha256])
                ->sortBy('path')->values()->all(),
        ];
    }

    public function revision(ServerTemplate $template, int $revision): ?ServerTemplateRevision
    {
        return $template->revisions()->where('revision', $revision)->first();
    }

    public function usageCount(ServerTemplate $template): int
    {
        return $template->instances()
            ->whereNotIn('state', [TemplateInstance::STATE_FAILED])
            ->count();
    }

    /**
     * Writes a new revision only when the effective content changed since the last one.
     */
    private function commit(ServerTemplate $template): void
    {
        $snapshot = $this->snapshot($template);
        $latest = $template->revisions()->first();
        if ($latest && $latest->snapshot == json_decode(json_encode($snapshot), true)) {
            return;
        }

        $template->revision = $latest ? $latest->revision + 1 : 1;
        $template->save();
        $this->record($template);
    }

    private function record(ServerTemplate $template): void
    {
        ServerTemplateRevision::query()->create([
            'template_id' => $template->id,
            'revision' => $template->revision,
            'snapshot' => $this->snapshot($template->refresh()),
        ]);
    }

    private function fill(ServerTemplate $template, array $data): void
    {
        foreach (self::SCALAR_FIELDS as $field) {
            if ($field === 'slug' || !array_key_exists($field, $data)) {
                continue;
            }
            $template->{$field} = $data[$field];
        }

        // A template that is not fixed to one node carries no stale node reference.
        if ($template->placement_mode !== ServerTemplate::PLACEMENT_FIXED) {
            $template->node_id = null;
        }
    }

    private function syncRelations(ServerTemplate $template, array $data): void
    {
        $nodes = $template->placement_mode === ServerTemplate::PLACEMENT_ALLOWED
            ? Node::query()->whereIn('id', $data['allowed_nodes'] ?? [])->pluck('id')->all()
            : [];
        $template->allowedNodes()->sync($nodes);

        if (array_key_exists('variables', $data)) {
            $template->variables()->delete();
            $known = EggVariable::query()->where('egg_id', $template->egg_id)->get()->keyBy('env_variable');
            foreach ($data['variables'] as $env => $row) {
                $variable = $known->get($env);
                $value = $row['value'] ?? null;
                $overridable = (bool) ($row['overridable'] ?? false);
                if (!$variable || ($value === null && !$overridable)) {
                    continue;
                }
                ServerTemplateVariable::query()->insert([
                    'template_id' => $template->id,
                    'egg_variable_id' => $variable->id,
                    'value' => $value,
                    'overridable' => $overridable,
                ]);
            }
        }
        $template->unsetRelation('variables');
        $template->unsetRelation('allowedNodes');
    }

    private function uniqueSlug(string $base): string
    {
        $slug = Str::slug($base) ?: 'template';
        $slug = Str::limit($slug, 70, '');
        $candidate = $slug;
        for ($i = 2; ServerTemplate::query()->where('slug', $candidate)->exists(); ++$i) {
            $candidate = $slug . '-' . $i;
        }

        return $candidate;
    }
}
