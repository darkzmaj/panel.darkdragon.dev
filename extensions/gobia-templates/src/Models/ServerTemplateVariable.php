<?php

declare(strict_types=1);

namespace GobiaTemplates\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * @property int $template_id
 * @property int $egg_variable_id
 * @property string|null $value
 * @property bool $overridable
 */
class ServerTemplateVariable extends Model
{
    public $timestamps = false;

    public $incrementing = false;

    protected $table = 'gobia_template_variables';

    protected $primaryKey;

    protected $guarded = [];

    protected $casts = ['template_id' => 'int', 'egg_variable_id' => 'int', 'overridable' => 'bool'];
}
