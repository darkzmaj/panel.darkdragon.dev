<?php

declare(strict_types=1);

namespace GobiaTemplates\Models;

use Illuminate\Database\Eloquent\Model;
use Pterodactyl\Models\User;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An SFTP login that reaches exactly one template's working files. The secret is stored as a hash only.
 *
 * @property int $id
 * @property int $template_id
 * @property int|null $created_by
 * @property string|null $label
 * @property string $username
 * @property string $password_hash
 * @property string $permission rw or ro
 * @property \Illuminate\Support\Carbon|null $expires_at
 * @property \Illuminate\Support\Carbon|null $revoked_at
 * @property \Illuminate\Support\Carbon|null $last_used_at
 * @property string|null $last_used_ip
 * @property ServerTemplate $template
 */
class TemplateSftpCredential extends Model
{
    public const READ_WRITE = 'rw';
    public const READ_ONLY = 'ro';

    protected $table = 'gobia_template_sftp_credentials';

    protected $guarded = ['id'];

    protected $hidden = ['password_hash'];

    protected $casts = [
        'id' => 'int',
        'template_id' => 'int',
        'created_by' => 'int',
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
        'last_used_at' => 'datetime',
    ];

    public function getRouteKeyName(): string
    {
        return 'id';
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(ServerTemplate::class, 'template_id');
    }

    public function isActive(): bool
    {
        return is_null($this->revoked_at) && (is_null($this->expires_at) || $this->expires_at->isFuture());
    }

    public function status(): string
    {
        return $this->revoked_at ? 'revoked' : ($this->expires_at && $this->expires_at->isPast() ? 'expired' : 'active');
    }
}
