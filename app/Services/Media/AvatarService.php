<?php

namespace Pterodactyl\Services\Media;

use Pterodactyl\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class AvatarService
{
    public const MAX_SIZE = 256;

    /**
     * The size of the small copy served wherever the avatar is only shown at icon size.
     */
    public const THUMBNAIL_SIZE = 64;

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

        $disk = Storage::disk('local');
        $disk->put(self::path($user), $contents);
        $disk->put(self::path($user, true), $this->processor->normalize($file->getRealPath(), self::THUMBNAIL_SIZE, self::THUMBNAIL_SIZE, true));
        $user->forceFill(['avatar_hash' => substr(sha1($contents), 0, 16)])->save();

        return $user;
    }

    public function remove(User $user): User
    {
        Storage::disk('local')->delete([self::path($user), self::path($user, true)]);
        $user->forceFill(['avatar_hash' => null])->save();

        return $user;
    }

    public static function path(User $user, bool $thumbnail = false): string
    {
        return 'avatars/' . $user->uuid . ($thumbnail ? '-' . self::THUMBNAIL_SIZE : '') . '.png';
    }

    /**
     * Returns the storage path of the requested avatar variant. Avatars uploaded before
     * thumbnails existed get theirs generated the first time it is requested.
     */
    public function resolve(User $user, bool $thumbnail): string
    {
        $disk = Storage::disk('local');
        if (!$thumbnail) {
            return self::path($user);
        }

        if (!$disk->exists(self::path($user, true))) {
            $disk->put(
                self::path($user, true),
                $this->processor->normalize($disk->path(self::path($user)), self::THUMBNAIL_SIZE, self::THUMBNAIL_SIZE, true),
            );
        }

        return self::path($user, true);
    }
}
