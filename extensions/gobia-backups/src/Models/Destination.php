<?php

declare(strict_types=1);

namespace GobiaBackups\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A Storage Box account (main or sub account) that backups are written to.
 *
 * The private key, password and encryption key are encrypted with the Panel key at rest and hidden from every
 * serialisation, so they cannot reach an API response by accident.
 *
 * @property int $id
 * @property string $name
 * @property string $type
 * @property string $host
 * @property int $port
 * @property string $username
 * @property string|null $private_key
 * @property string|null $password
 * @property string $host_key_fingerprint
 * @property string $base_path
 * @property bool $encrypt
 * @property string|null $encryption_key base64 of the 32 byte key
 * @property bool $enabled
 * @property \Illuminate\Support\Carbon|null $last_checked_at
 * @property string|null $last_error
 */
class Destination extends Model
{
    protected $table = 'gobia_backup_destinations';

    protected $guarded = ['id'];

    protected $hidden = ['private_key', 'password', 'encryption_key'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'port' => 'integer',
            'encrypt' => 'boolean',
            'enabled' => 'boolean',
            'private_key' => 'encrypted',
            'password' => 'encrypted',
            'encryption_key' => 'encrypted',
            'last_checked_at' => 'datetime',
        ];
    }

    /** @return HasMany<Run, $this> */
    public function runs(): HasMany
    {
        return $this->hasMany(Run::class, 'destination_id');
    }

    /** What an administrator may see. Secrets are reported as present or absent, never as values. */
    public function summary(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'type' => $this->type,
            'host' => $this->host,
            'port' => $this->port,
            'username' => $this->username,
            'host_key_fingerprint' => $this->host_key_fingerprint,
            'base_path' => $this->base_path,
            'encrypt' => $this->encrypt,
            'enabled' => $this->enabled,
            'has_private_key' => $this->private_key !== null,
            'has_password' => $this->password !== null,
            'last_checked_at' => $this->last_checked_at?->toIso8601String(),
            'last_error' => $this->last_error,
        ];
    }
}
