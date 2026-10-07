<?php

declare(strict_types=1);

namespace GobiaTemplates\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * @property int $id
 * @property int $template_id
 * @property int $revision
 * @property array $snapshot
 * @property int|null $created_by
 * @property \Illuminate\Support\Carbon $created_at
 */
class ServerTemplateRevision extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'gobia_template_revisions';

    protected $guarded = ['id'];

    protected $casts = ['id' => 'int', 'template_id' => 'int', 'revision' => 'int', 'snapshot' => 'array', 'created_by' => 'int'];
}
