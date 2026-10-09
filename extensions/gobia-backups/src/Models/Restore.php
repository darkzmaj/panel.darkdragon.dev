<?php

declare(strict_types=1);

namespace GobiaBackups\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Pterodactyl\Models\Server;

/**
 * One restore of an offsite backup into a server.
 *
 * @property int $id
 * @property string $uuid
 * @property int $run_id
 * @property int $server_id
 * @property string $backup_uuid
 * @property int|null $requested_by
 * @property bool $truncate
 * @property string $state
 * @property int $transferred_bytes
 * @property string|null $error
 * @property \Illuminate\Support\Carbon|null $completed_at
 * @property \Illuminate\Support\Carbon $created_at
 * @property Run $run
 * @property Server $server
 */
class Restore extends Model
{
    /** Wings was asked to restore and has not fetched the archive yet. */
    public const string REQUESTED = 'requested';

    /** Wings is downloading the archive through the Panel. */
    public const string STREAMING = 'streaming';

    /** The whole archive was handed to Wings, which is unpacking it. */
    public const string UNPACKING = 'unpacking';

    public const string COMPLETED = 'completed';

    public const string FAILED = 'failed';

    public const array ACTIVE = [self::REQUESTED, self::STREAMING, self::UNPACKING];

    protected $table = 'gobia_backup_restores';

    protected $guarded = ['id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['truncate' => 'boolean', 'transferred_bytes' => 'integer', 'completed_at' => 'datetime'];
    }

    /** @return BelongsTo<Run, $this> */
    public function run(): BelongsTo
    {
        return $this->belongsTo(Run::class, 'run_id');
    }

    /** @return BelongsTo<Server, $this> */
    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class, 'server_id');
    }

    /** @return array<string, mixed> */
    public function summary(): array
    {
        return [
            'id' => $this->uuid,
            'backup' => $this->run->uuid,
            'state' => $this->state,
            'transferred_bytes' => $this->transferred_bytes,
            'error' => $this->error,
            'created_at' => $this->created_at->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),
        ];
    }
}
