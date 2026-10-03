<?php

namespace Pterodactyl\Models;

/**
 * @property int $id
 * @property int $template_id
 * @property int $revision
 * @property array $snapshot
 * @property \Illuminate\Support\Carbon $created_at
 */
class ServerTemplateRevision extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'server_template_revisions';

    protected $guarded = ['id'];

    protected $casts = ['id' => 'int', 'template_id' => 'int', 'revision' => 'int', 'snapshot' => 'array'];
}
