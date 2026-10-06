<?php

declare(strict_types=1);

namespace GobiaCore\Services;

use GobiaCore\Models\UserProfile;
use GobiaCore\Support\PngImageProcessor;
use Illuminate\Http\UploadedFile;
use Pterodactyl\Models\User;
use Pterodactyl\Services\Extensions\ExtensionSettingFiles;

/**
 * Stores user avatars through the panel's extension file store: content detected, random server generated names,
 * served immutably from /extension-files/gobia-core/<name>. The upload is normalised to a 256 px square PNG first.
 */
class AvatarService
{
    public const string EXTENSION = 'gobia-core';

    public const int SIZE = 256;

    public function __construct(private readonly PngImageProcessor $processor, private readonly ExtensionSettingFiles $files) {}

    public function store(User $user, UploadedFile $upload): UserProfile
    {
        $bytes = $this->processor->normalize($upload->getRealPath(), self::SIZE, self::SIZE, true);

        $temporary = tempnam(sys_get_temp_dir(), 'gbav');
        file_put_contents($temporary, $bytes);
        try {
            $name = $this->files->store(self::EXTENSION, new UploadedFile($temporary, 'avatar.png', 'image/png', null, true), ['image/png'], 512);
        } finally {
            @unlink($temporary);
        }

        $profile = UserProfile::forUser($user);
        $previous = $profile->avatar_file;
        $profile->update(['avatar_file' => $name]);
        if ($previous !== null) {
            $this->files->delete(self::EXTENSION, $previous);
        }

        return $profile;
    }

    public function remove(User $user): UserProfile
    {
        $profile = UserProfile::forUser($user);
        $previous = $profile->avatar_file;
        $profile->update(['avatar_file' => null]);
        if ($previous !== null) {
            $this->files->delete(self::EXTENSION, $previous);
        }

        return $profile;
    }

    public static function url(UserProfile $profile): ?string
    {
        return $profile->avatar_file === null ? null : ExtensionSettingFiles::url(self::EXTENSION, $profile->avatar_file);
    }
}
