<?php

namespace Pterodactyl\Models;

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

    protected $table = 'server_template_variables';

    protected $primaryKey;

    protected $guarded = [];

    protected $casts = ['template_id' => 'int', 'egg_variable_id' => 'int', 'overridable' => 'bool'];
}
