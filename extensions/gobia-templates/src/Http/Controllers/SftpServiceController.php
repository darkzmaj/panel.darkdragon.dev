<?php

declare(strict_types=1);

namespace GobiaTemplates\Http\Controllers;

use GobiaTemplates\Services\TemplateSftpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Used by the template SFTP process only. Every request needs the shared service token (see RequireSftpServiceToken). */
class SftpServiceController
{
    public function __construct(private readonly TemplateSftpService $sftp) {}

    /** Checks a login. Answers 401 without saying whether the username, password or credential state was wrong. */
    public function authenticate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'username' => 'required|string|max:64',
            'password' => 'required|string|max:200',
            'ip' => 'required|string|max:45',
        ]);
        $result = $this->sftp->authenticate($data['username'], $data['password'], $data['ip']);

        return $result ? new JsonResponse($result) : new JsonResponse(['error' => 'Authentication failed.'], 401);
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

        return new JsonResponse([], 204);
    }
}
