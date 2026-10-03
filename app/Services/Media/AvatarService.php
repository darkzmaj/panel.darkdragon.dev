<?php

namespace Pterodactyl\Services\Media;

use Pterodactyl\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class AvatarService
{
    public const MAX_SIZE = 256;

    public function __construct(private PngImageProcessor $processor)
    {
    }

    /**
     * Normalize the uploaded PNG and store it as the user's avatar. The storage path is
     * derived from the user's UUID so the client supplied file name is never used.
     *
     * @throws \Pterodactyl\Exceptions\DisplayException
     */
    public function store(User $user, UploadedFile $file): User
    {
        $contents = $this->processor->normalize($file->getRealPath(), self::MAX_SIZE, self::MAX_SIZE, true);

        Storage::disk('local')->put(self::path($user), $contents);
        $user->forceFill(['avatar_hash' => substr(sha1($contents), 0, 16)])->save();

        return $user;
    }

    public function remove(User $user): User
    {
        Storage::disk('local')->delete(self::path($user));
        $user->forceFill(['avatar_hash' => null])->save();

        return $user;
    }

    public static function path(User $user): string
    {
        return 'avatars/' . $user->uuid . '.png';
    }
}
