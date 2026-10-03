<?php

namespace Pterodactyl\Http\Controllers\Base;

use Illuminate\Http\Request;
use Pterodactyl\Models\User;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Services\Media\AvatarService;

class AvatarController extends Controller
{
    public function __construct(private AvatarService $avatars)
    {
    }

    /**
     * Serve a user's uploaded profile picture, either the full image or, with "?s=64", a
     * small copy for icon-sized use. Avatars are only available to signed in users and are
     * never exposed through a public storage directory.
     */
    public function __invoke(Request $request, string $uuid): Response
    {
        $user = User::query()->where('uuid', $uuid)->firstOrFail();
        $disk = Storage::disk('local');

        if (is_null($user->avatar_hash) || !$disk->exists(AvatarService::path($user))) {
            abort(404);
        }

        $thumbnail = (int) $request->query('s') === AvatarService::THUMBNAIL_SIZE;
        $etag = $user->avatar_hash . ($thumbnail ? '-' . AvatarService::THUMBNAIL_SIZE : '');

        // The hash in the URL changes whenever the picture does, so a versioned URL can be cached indefinitely.
        $response = new Response('', 200, [
            'Content-Type' => 'image/png',
            'Content-Disposition' => 'inline',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'",
            'Cache-Control' => $request->query('v') === $user->avatar_hash
                ? 'private, max-age=31536000, immutable'
                : 'private, no-cache',
        ]);
        $response->setEtag($etag);

        if ($response->isNotModified($request)) {
            return $response;
        }

        return $response->setContent($disk->get($this->avatars->resolve($user, $thumbnail)));
    }
}
