<?php

declare(strict_types=1);

namespace GobiaBackups\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One level of the backup policy: global, one node or one server. A null field inherits from the level above.
 *
 * @property int $id
 * @property string $scope
 * @property int|null $node_id
 * @property int|null $server_id
 * @property int|null $destination_id
 * @property bool|null $enabled
 * @property string|null $cron
 * @property string|null $timezone
 * @property int|null $window_start
 * @property int|null $window_end
 * @property int|null $keep_last
 * @property int|null $keep_days
 * @property list<string>|null $ignored
 * @property bool|null $mirror_user_backups
 */
class Policy extends Model
{
    public const string SCOPE_GLOBAL = 'global';

    public const string SCOPE_NODE = 'node';

    public const string SCOPE_SERVER = 'server';

    /** The fields a level may set, with the value used when no level sets them. */
    public const array DEFAULTS = [
        'destination_id' => null,
        'enabled' => false,
        'cron' => '0 4 * * *',
        'timezone' => 'UTC',
        'window_start' => null,
        'window_end' => null,
        'keep_last' => 7,
        'keep_days' => null,
        'ignored' => [],
        'mirror_user_backups' => false,
    ];

    protected $table = 'gobia_backup_policies';

    protected $guarded = ['id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'mirror_user_backups' => 'boolean',
            'ignored' => 'array',
            'window_start' => 'integer',
            'window_end' => 'integer',
            'keep_last' => 'integer',
            'keep_days' => 'integer',
            'destination_id' => 'integer',
        ];
    }

    /** @return array<string, mixed> only the fields this level sets itself */
    public function overrides(): array
    {
        $set = [];
        foreach (array_keys(self::DEFAULTS) as $field) {
            if ($this->getAttribute($field) !== null) {
                $set[$field] = $this->getAttribute($field);
            }
        }

        return $set;
    }
}
