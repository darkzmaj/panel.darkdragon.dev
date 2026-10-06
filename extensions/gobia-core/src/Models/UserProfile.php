<?php

declare(strict_types=1);

namespace GobiaCore\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Pterodactyl\Models\User;

/**
 * Gobia data attached to a panel user. Lives in the extension's own table so the core users table is never altered.
 *
 * @property int $user_id
 * @property string|null $avatar_file
 * @property string $theme
 * @property list<string>|null $recent_icon_colors
 */
class UserProfile extends Model
{
    public const array THEMES = ['system', 'light', 'dark'];

    public $incrementing = false;

    protected $table = 'gobia_user_profiles';

    protected $primaryKey = 'user_id';

    protected $fillable = ['avatar_file', 'theme', 'recent_icon_colors'];

    protected $attributes = ['theme' => 'system'];

    protected function casts(): array
    {
        return ['recent_icon_colors' => 'array'];
    }

    public static function forUser(User $user): self
    {
        $profile = self::query()->find($user->id);
        if ($profile === null) {
            // user_id is deliberately not mass assignable.
            $profile = new self;
            $profile->user_id = $user->id;
            $profile->save();
        }

        return $profile;
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
