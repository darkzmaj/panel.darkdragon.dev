<?php

namespace Pterodactyl\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * An admin-defined blueprint for creating servers. Distinct from an egg: the egg describes the
 * software, a template adds resources, placement, variables, files and lifecycle on top of it.
 *
 * @property int $id
 * @property string $uuid
 * @property string $name
 * @property string $slug
 * @property string|null $description
 * @property bool $enabled
 * @property int $revision
 * @property int $nest_id
 * @property int $egg_id
 * @property string $docker_image
 * @property string|null $startup
 * @property int $memory
 * @property int $swap
 * @property int $disk
 * @property int $cpu
 * @property int $io
 * @property bool $oom_disabled
 * @property int|null $database_limit
 * @property int|null $allocation_limit
 * @property int|null $backup_limit
 * @property string $placement_mode
 * @property int|null $node_id
 * @property int|null $location_id
 * @property int $additional_allocations
 * @property string|null $preferred_ports
 * @property int|null $max_instances
 * @property bool $start_automatically
 * @property bool $temporary
 * @property int|null $ttl_minutes
 * @property bool $allow_instance_delete
 * @property \Illuminate\Support\Carbon|null $published_at
 * @property \Illuminate\Support\Carbon|null $working_changed_at
 * @property Egg $egg
 * @property Nest $nest
 * @property Node|null $node
 * @property Location|null $location
 * @property \Illuminate\Database\Eloquent\Collection<int, Node> $allowedNodes
 * @property \Illuminate\Database\Eloquent\Collection<int, ServerTemplateFile> $files
 * @property \Illuminate\Database\Eloquent\Collection<int, TemplateInstance> $instances
 */
class ServerTemplate extends Model
{
    public const RESOURCE_NAME = 'server_template';

    public const PLACEMENT_FIXED = 'fixed_node';
    public const PLACEMENT_ALLOWED = 'allowed_nodes';
    public const PLACEMENT_ANY = 'any';

    protected $table = 'server_templates';

    protected $guarded = ['id', 'uuid', 'revision', 'published_at', 'working_changed_at', 'created_at', 'updated_at'];

    protected $casts = [
        'id' => 'int',
        'enabled' => 'bool',
        'revision' => 'int',
        'nest_id' => 'int',
        'egg_id' => 'int',
        'memory' => 'int',
        'swap' => 'int',
        'disk' => 'int',
        'cpu' => 'int',
        'io' => 'int',
        'oom_disabled' => 'bool',
        'database_limit' => 'int',
        'allocation_limit' => 'int',
        'backup_limit' => 'int',
        'node_id' => 'int',
        'location_id' => 'int',
        'additional_allocations' => 'int',
        'max_instances' => 'int',
        'start_automatically' => 'bool',
        'temporary' => 'bool',
        'ttl_minutes' => 'int',
        'allow_instance_delete' => 'bool',
        'published_at' => 'datetime',
        'working_changed_at' => 'datetime',
    ];

    public function getRouteKeyName(): string
    {
        return 'id';
    }

    public function egg(): BelongsTo
    {
        return $this->belongsTo(Egg::class);
    }

    public function nest(): BelongsTo
    {
        return $this->belongsTo(Nest::class);
    }

    public function node(): BelongsTo
    {
        return $this->belongsTo(Node::class);
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }

    public function allowedNodes(): BelongsToMany
    {
        return $this->belongsToMany(Node::class, 'server_template_nodes', 'template_id', 'node_id');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany<ServerTemplateFile, $this>
     */
    public function files(): HasMany
    {
        return $this->hasMany(ServerTemplateFile::class, 'template_id')->orderBy('path');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany<ServerTemplateVariable, $this>
     */
    public function variables(): HasMany
    {
        return $this->hasMany(ServerTemplateVariable::class, 'template_id');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany<ServerTemplateRevision, $this>
     */
    public function revisions(): HasMany
    {
        return $this->hasMany(ServerTemplateRevision::class, 'template_id')->orderByDesc('revision');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany<TemplateSftpCredential, $this>
     */
    public function sftpCredentials(): HasMany
    {
        return $this->hasMany(TemplateSftpCredential::class, 'template_id')->orderByDesc('id');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany<TemplateInstance, $this>
     */
    public function instances(): HasMany
    {
        return $this->hasMany(TemplateInstance::class, 'template_id');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany<Server, $this>
     */
    public function servers(): HasMany
    {
        return $this->hasMany(Server::class, 'template_id');
    }
}
