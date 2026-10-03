<?php

namespace Pterodactyl\Http\Controllers\Api\Internal;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Services\Templates\TemplateSftpService;

class TemplateSftpController extends Controller
{
    public function __construct(private TemplateSftpService $sftp)
    {
    }

    /**
     * Checks a login. Responds 401 without saying whether the username, the password or the credential state was wrong.
     */
    public function authenticate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'username' => 'required|string|max:64',
            'password' => 'required|string|max:200',
            'ip' => 'required|string|max:45',
        ]);

        $result = $this->sftp->authenticate($data['username'], $data['password'], $data['ip']);
        if (!$result) {
            return new JsonResponse(['error' => 'Authentication failed.'], Response::HTTP_UNAUTHORIZED);
        }

        return new JsonResponse($result);
    }

    public function session(Request $request): JsonResponse
    {
        $data = $request->validate([
            'credential' => 'required|integer',
            'files_changed' => 'required|integer|min:0',
            'bytes_written' => 'required|integer|min:0',
            'ip' => 'required|string|max:45',
        ]);

        $this->sftp->sessionEnded($data['credential'], $data['files_changed'], $data['bytes_written'], $data['ip']);

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }
}
