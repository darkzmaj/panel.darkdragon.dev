<?php

namespace Pterodactyl\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One request to create a server from a template, tracked through the provisioning pipeline.
 *
 * @property int $id
 * @property string $uuid
 * @property int $template_id
 * @property int $template_revision
 * @property int|null $server_id
 * @property int $owner_id
 * @property int|null $api_key_id
 * @property string $name
 * @property string $state
 * @property string|null $failed_stage
 * @property string|null $error
 * @property int $attempts
 * @property int|null $node_id
 * @property array|null $overrides
 * @property string|null $idempotency_key
 * @property string|null $request_hash
 * @property \Illuminate\Support\Carbon|null $expires_at
 * @property \Illuminate\Support\Carbon|null $state_changed_at
 * @property ServerTemplate $template
 * @property Server|null $server
 * @property User $owner
 */
class TemplateInstance extends Model
{
    public const RESOURCE_NAME = 'template_instance';

    public const STATE_QUEUED = 'queued';
    public const STATE_ALLOCATING = 'allocating';
    public const STATE_CREATING = 'creating';
    public const STATE_INSTALLING = 'installing';
    public const STATE_DEPLOYING_FILES = 'deploying_files';
    public const STATE_STARTING = 'starting';
    public const STATE_READY = 'ready';
    public const STATE_FAILED = 'failed';

    protected $table = 'server_template_instances';

    protected $guarded = ['id'];

    protected $casts = [
        'id' => 'int',
        'template_id' => 'int',
        'template_revision' => 'int',
        'server_id' => 'int',
        'owner_id' => 'int',
        'api_key_id' => 'int',
        'attempts' => 'int',
        'node_id' => 'int',
        'overrides' => 'array',
        'expires_at' => 'datetime',
        'state_changed_at' => 'datetime',
    ];

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(ServerTemplate::class, 'template_id');
    }

    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class);
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function isFinished(): bool
    {
        return in_array($this->state, [self::STATE_READY, self::STATE_FAILED], true);
    }
}
