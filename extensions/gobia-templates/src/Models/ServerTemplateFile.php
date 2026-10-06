<?php

declare(strict_types=1);

namespace GobiaTemplates\Models;

use Illuminate\Database\Eloquent\Model;
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
    protected $table = 'gobia_template_files';

    protected $guarded = ['id'];

    protected $casts = ['id' => 'int', 'template_id' => 'int', 'size' => 'int'];

    public function template(): BelongsTo
    {
        return $this->belongsTo(ServerTemplate::class, 'template_id');
    }
}
