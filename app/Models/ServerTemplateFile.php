<?php

namespace Pterodactyl\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $template_id
 * @property string $path
 * @property int $size
 * @property string $sha256
 */
class ServerTemplateFile extends Model
{
    protected $table = 'server_template_files';

    protected $guarded = ['id'];

    protected $casts = ['id' => 'int', 'template_id' => 'int', 'size' => 'int'];

    public function template(): BelongsTo
    {
        return $this->belongsTo(ServerTemplate::class, 'template_id');
    }
}
