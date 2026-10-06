<?php

declare(strict_types=1);

namespace GobiaTemplates\Services;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Copies the template data of a Gobia 1.x panel into the gobia_ tables of this extension: templates and their
 * placement and variables, file metadata, immutable revisions, instances and the template SFTP credentials and events.
 *
 * It only reads the 1.x tables. Rows keep their ids (so revisions, instances and SFTP records stay linked) and rows that
 * already exist here are left alone, which makes it safe to run again. The file content is not copied: it lives under the
 * template storage directory, which 1.x and 2.0 share by default (storage/app/private/templates, keyed by template uuid).
 */
class LegacyImporter
{
    private const SKIPPED = 'skipped (parent row gone)';

    public function __construct(private readonly TemplateFileStore $files) {}

    /** @return array<string, int> */
    public function run(?string $connection = null, bool $dryRun = false): array
    {
        $legacy = DB::connection($connection);
        $report = [self::SKIPPED => 0];

        DB::beginTransaction();
        try {
            $this->templates($legacy, $report);
            $this->children($legacy, $report);
            $this->instances($legacy, $report);
            $this->sftp($legacy, $report);
            // Read only, but it looks at the rows just copied, so it runs before a dry run is rolled back.
            $this->storage($legacy, $report);
            $dryRun ? DB::rollBack() : DB::commit();
        } catch (Throwable $exception) {
            DB::rollBack();
            throw $exception;
        }

        $this->apiKeys($legacy, $report);

        return $report;
    }

    private function has(ConnectionInterface $legacy, string $table): bool
    {
        return Schema::connection($legacy->getName())->hasTable($table);
    }

    /** @param  array<string, int>  $report */
    private function templates(ConnectionInterface $legacy, array &$report): void
    {
        $report['templates'] = 0;
        if (! $this->has($legacy, 'server_templates')) {
            return;
        }
        $eggs = DB::table('eggs')->pluck('id')->flip();
        $nodes = DB::table('nodes')->pluck('id')->flip();
        $locations = DB::table('locations')->pluck('id')->flip();

        foreach ($legacy->table('server_templates')->orderBy('id')->cursor() as $row) {
            if (! isset($eggs[$row->egg_id])) {
                $report[self::SKIPPED]++;

                continue;
            }
            $report['templates'] += DB::table('gobia_server_templates')->insertOrIgnore([
                'id' => $row->id,
                'uuid' => $row->uuid,
                'name' => $row->name,
                'slug' => $row->slug,
                'description' => $row->description,
                'enabled' => $row->enabled,
                // 1.x had its own template API keys; 2.0 needs the switch per template. Turn it on deliberately.
                'api_enabled' => false,
                'revision' => $row->revision,
                'egg_id' => $row->egg_id,
                'docker_image' => $row->docker_image,
                'startup' => $row->startup,
                'memory' => $row->memory,
                'swap' => $row->swap,
                'disk' => $row->disk,
                'cpu' => $row->cpu,
                'io' => $row->io,
                'oom_disabled' => $row->oom_disabled,
                'database_limit' => $row->database_limit,
                'allocation_limit' => $row->allocation_limit,
                'backup_limit' => $row->backup_limit,
                'placement_mode' => $row->placement_mode,
                'node_id' => isset($nodes[$row->node_id]) ? $row->node_id : null,
                'location_id' => isset($locations[$row->location_id]) ? $row->location_id : null,
                'additional_allocations' => $row->additional_allocations,
                'preferred_ports' => $row->preferred_ports,
                'max_instances' => $row->max_instances,
                'start_automatically' => $row->start_automatically,
                'temporary' => $row->temporary,
                'ttl_minutes' => $row->ttl_minutes,
                'allow_instance_delete' => $row->allow_instance_delete,
                'published_at' => $row->published_at ?? null,
                'working_changed_at' => $row->working_changed_at ?? null,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ]);
        }
    }

    /** @param  array<string, int>  $report */
    private function children(ConnectionInterface $legacy, array &$report): void
    {
        $templates = DB::table('gobia_server_templates')->pluck('id')->flip();
        $nodes = DB::table('nodes')->pluck('id')->flip();
        $variables = DB::table('egg_variables')->pluck('id')->flip();

        $report['allowed nodes'] = $this->copy($legacy, 'server_template_nodes', 'gobia_template_nodes', fn (object $row): ?array => isset($templates[$row->template_id], $nodes[$row->node_id])
            ? ['template_id' => $row->template_id, 'node_id' => $row->node_id] : null, $report);

        $report['variables'] = $this->copy($legacy, 'server_template_variables', 'gobia_template_variables', fn (object $row): ?array => isset($templates[$row->template_id], $variables[$row->egg_variable_id])
            ? ['template_id' => $row->template_id, 'egg_variable_id' => $row->egg_variable_id, 'value' => $row->value, 'overridable' => $row->overridable] : null, $report);

        $report['file records'] = $this->copy($legacy, 'server_template_files', 'gobia_template_files', fn (object $row): ?array => isset($templates[$row->template_id])
            ? ['id' => $row->id, 'template_id' => $row->template_id, 'path' => $row->path, 'size' => $row->size, 'sha256' => $row->sha256, 'created_at' => $row->created_at, 'updated_at' => $row->updated_at] : null, $report);

        // Revision snapshots are copied byte for byte; they are immutable and 1.x extras such as nest_id are ignored.
        $report['revisions'] = $this->copy($legacy, 'server_template_revisions', 'gobia_template_revisions', fn (object $row): ?array => isset($templates[$row->template_id])
            ? ['id' => $row->id, 'template_id' => $row->template_id, 'revision' => $row->revision, 'snapshot' => $row->snapshot, 'created_at' => $row->created_at] : null, $report);
    }

    /** @param  array<string, int>  $report */
    private function instances(ConnectionInterface $legacy, array &$report): void
    {
        $templates = DB::table('gobia_server_templates')->pluck('id')->flip();
        $users = DB::table('users')->pluck('id')->flip();
        $servers = DB::table('servers')->pluck('id')->flip();

        $report['instances'] = $this->copy($legacy, 'server_template_instances', 'gobia_template_instances', function (object $row) use ($templates, $users, $servers): ?array {
            if (! isset($templates[$row->template_id], $users[$row->owner_id])) {
                return null;
            }

            return [
                'id' => $row->id,
                'uuid' => $row->uuid,
                'template_id' => $row->template_id,
                'template_revision' => $row->template_revision,
                'server_id' => isset($servers[$row->server_id]) ? $row->server_id : null,
                'owner_id' => $row->owner_id,
                // The old key does not exist as an application key here; the link is informational only.
                'api_key_id' => null,
                'name' => $row->name,
                'state' => $row->state,
                'failed_stage' => $row->failed_stage,
                'error' => $row->error,
                'attempts' => $row->attempts,
                'node_id' => $row->node_id,
                'overrides' => $row->overrides,
                'idempotency_key' => $row->idempotency_key,
                'request_hash' => $row->request_hash,
                'expires_at' => $row->expires_at,
                'state_changed_at' => $row->state_changed_at,
                'stage_ms' => $row->stage_ms ?? null,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ];
        }, $report);
    }

    /** @param  array<string, int>  $report */
    private function sftp(ConnectionInterface $legacy, array &$report): void
    {
        $templates = DB::table('gobia_server_templates')->pluck('id')->flip();
        $users = DB::table('users')->pluck('id')->flip();

        $report['sftp credentials'] = $this->copy($legacy, 'template_sftp_credentials', 'gobia_template_sftp_credentials', fn (object $row): ?array => isset($templates[$row->template_id]) ? [
            'id' => $row->id,
            'template_id' => $row->template_id,
            'created_by' => isset($users[$row->created_by]) ? $row->created_by : null,
            'label' => $row->label,
            'username' => $row->username,
            // Only the hash was ever stored, and it is carried over unchanged, so existing passwords keep working.
            'password_hash' => $row->password_hash,
            'permission' => $row->permission,
            'expires_at' => $row->expires_at,
            'revoked_at' => $row->revoked_at,
            'last_used_at' => $row->last_used_at,
            'last_used_ip' => $row->last_used_ip,
            'created_at' => $row->created_at,
            'updated_at' => $row->updated_at,
        ] : null, $report);

        $credentials = DB::table('gobia_template_sftp_credentials')->pluck('id')->flip();
        $report['sftp events'] = $this->copy($legacy, 'template_sftp_events', 'gobia_template_sftp_events', fn (object $row): array => [
            'id' => $row->id,
            'credential_id' => isset($credentials[$row->credential_id]) ? $row->credential_id : null,
            'template_id' => isset($templates[$row->template_id]) ? $row->template_id : null,
            'username' => $row->username,
            'event' => $row->event,
            'ip' => $row->ip,
            'detail' => $row->detail,
            'created_at' => $row->created_at,
        ], $report);
    }

    /**
     * @param  callable(object): (array<string, mixed>|null)  $map  Returns the destination row, or null to skip it.
     * @param  array<string, int>  $report
     */
    private function copy(ConnectionInterface $legacy, string $from, string $to, callable $map, array &$report): int
    {
        if (! $this->has($legacy, $from)) {
            return 0;
        }
        $copied = 0;
        foreach ($legacy->table($from)->cursor() as $row) {
            $mapped = $map($row);
            if ($mapped === null) {
                $report[self::SKIPPED]++;

                continue;
            }
            $copied += DB::table($to)->insertOrIgnore($mapped);
        }

        return $copied;
    }

    /**
     * The files themselves are not moved. Report whether each imported template still has its directory and every blob its
     * revisions point at, so a missing storage path is noticed before the first instance is created.
     *
     * @param  array<string, int>  $report
     */
    private function storage(ConnectionInterface $legacy, array &$report): void
    {
        $report['template directories found'] = 0;
        $report['template directories missing'] = 0;
        $report['published blobs missing'] = 0;
        foreach (DB::table('gobia_server_templates')->get(['id', 'uuid']) as $row) {
            $directory = $this->files->root().DIRECTORY_SEPARATOR.$row->uuid;
            if (! is_dir($directory)) {
                $report['template directories missing']++;

                continue;
            }
            $report['template directories found']++;
            foreach (DB::table('gobia_template_files')->where('template_id', $row->id)->pluck('sha256') as $hash) {
                if (! is_file($directory.DIRECTORY_SEPARATOR.'blobs'.DIRECTORY_SEPARATOR.$hash)) {
                    $report['published blobs missing']++;
                }
            }
        }
    }

    /**
     * 1.x gave API keys template permissions. Those columns are not used here (an application key with the servers
     * permission plus the template's own API switch replaces them), so only count the keys the administrator has to review.
     *
     * @param  array<string, int>  $report
     */
    private function apiKeys(ConnectionInterface $legacy, array &$report): void
    {
        $report['api keys to review'] = 0;
        $schema = Schema::connection($legacy->getName());
        if (! $schema->hasColumn('api_keys', 'r_template_instance_create')) {
            return;
        }
        $report['api keys to review'] = $legacy->table('api_keys')
            ->where(fn ($query) => $query->where('r_template_instance_create', '>', 0)->orWhere('r_template_instance_delete', '>', 0))
            ->count();
    }
}
