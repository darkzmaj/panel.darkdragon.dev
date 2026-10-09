<?php

declare(strict_types=1);

namespace GobiaBackups\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Pterodactyl\Models\Server;

/**
 * One offsite backup of one server, from "queued" to a verified object on the Storage Box.
 *
 * @property int $id
 * @property string $uuid
 * @property int|null $server_id
 * @property string $server_uuid
 * @property string $server_name
 * @property int|null $node_id
 * @property int $destination_id
 * @property string|null $backup_uuid
 * @property string $trigger
 * @property int|null $requested_by
 * @property string $state
 * @property int $attempts
 * @property bool $keep_local
 * @property bool $encrypted
 * @property string|null $remote_path
 * @property int $bytes
 * @property string|null $archive_sha256
 * @property int $stored_bytes
 * @property string|null $stored_sha256
 * @property int $transferred_bytes
 * @property string|null $verified_by
 * @property string|null $error
 * @property \Illuminate\Support\Carbon|null $retry_at
 * @property \Illuminate\Support\Carbon|null $started_at
 * @property \Illuminate\Support\Carbon|null $heartbeat_at
 * @property \Illuminate\Support\Carbon|null $completed_at
 * @property \Illuminate\Support\Carbon $created_at
 * @property Destination $destination
 * @property Server|null $server
 */
class Run extends Model
{
    /** Waiting for a free slot. */
    public const string QUEUED = 'queued';

    /** Wings is building the archive on the node. */
    public const string ARCHIVING = 'archiving';

    /** The archive exists on the node and waits for, or is in, its upload. */
    public const string UPLOADING = 'uploading';

    public const string COMPLETED = 'completed';

    public const string FAILED = 'failed';

    /** Removed by retention or by an administrator; the row stays as history. */
    public const string DELETED = 'deleted';

    public const array ACTIVE = [self::QUEUED, self::ARCHIVING, self::UPLOADING];

    public const string TRIGGER_SCHEDULE = 'schedule';

    public const string TRIGGER_MANUAL = 'manual';

    public const string TRIGGER_MIRROR = 'mirror';

    protected $table = 'gobia_backup_runs';

    protected $guarded = ['id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'keep_local' => 'boolean',
            'encrypted' => 'boolean',
            'attempts' => 'integer',
            'bytes' => 'integer',
            'stored_bytes' => 'integer',
            'transferred_bytes' => 'integer',
            'retry_at' => 'datetime',
            'started_at' => 'datetime',
            'heartbeat_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Destination, $this> */
    public function destination(): BelongsTo
    {
        return $this->belongsTo(Destination::class, 'destination_id');
    }

    /** @return BelongsTo<Server, $this> */
    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class, 'server_id');
    }

    public function isActive(): bool
    {
        return in_array($this->state, self::ACTIVE, true);
    }

    /**
     * What the owner of the server may see. Nothing about the destination: where backups are kept is the
     * administrator's business.
     *
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        return [
            'id' => $this->uuid,
            'state' => $this->state,
            'trigger' => $this->trigger,
            'bytes' => $this->bytes,
            'transferred_bytes' => $this->transferred_bytes,
            'encrypted' => $this->encrypted,
            'error' => $this->state === self::FAILED ? $this->error : null,
            'created_at' => $this->created_at->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),
        ];
    }

    /** @return array<string, mixed> */
    public function adminSummary(): array
    {
        return $this->summary() + [
            'server' => ['uuid' => $this->server_uuid, 'name' => $this->server_name, 'exists' => $this->server_id !== null],
            'destination_id' => $this->destination_id,
            'attempts' => $this->attempts,
            'stored_bytes' => $this->stored_bytes,
            'archive_sha256' => $this->archive_sha256,
            'verified_by' => $this->verified_by,
            'kept_on_node' => $this->keep_local,
        ];
    }
}
