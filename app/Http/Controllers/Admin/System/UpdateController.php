<?php

namespace Pterodactyl\Http\Controllers\Admin\System;

use Illuminate\View\View;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Facades\Activity;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Services\Updater\UpdateService;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;
use Pterodactyl\Http\Requests\Admin\System\StartUpdateRequest;
use Pterodactyl\Http\Requests\Admin\System\UpdateAdminRequest;

class UpdateController extends Controller
{
    public function __construct(private UpdateService $updates)
    {
    }

    public function index(UpdateAdminRequest $request): View
    {
        return view('admin.system.updates', ['status' => $this->updates->status()]);
    }

    public function status(UpdateAdminRequest $request): JsonResponse
    {
        return new JsonResponse($this->updates->status());
    }

    /**
     * Asks the update source for the newest release. The result is cached so page loads never hit GitHub.
     */
    public function check(UpdateAdminRequest $request): JsonResponse
    {
        return new JsonResponse($this->updates->check(true));
    }

    /**
     * Starts an update to the given version, or reports the update that is already running.
     */
    public function start(StartUpdateRequest $request): JsonResponse
    {
        try {
            [$created, $run] = $this->updates->start(
                $request->validated('version'),
                ['id' => $request->user()->id, 'username' => $request->user()->username]
            );
        } catch (UpdateException $exception) {
            return new JsonResponse(['error' => $exception->getMessage()], 422);
        }

        if ($created) {
            Activity::event('admin:system.update-started')->property(['from' => $run['from_version'], 'to' => $run['to_version']])->log();
        }

        return new JsonResponse(['started' => $created, 'run' => $run], $created ? 202 : 200);
    }

    /**
     * The detailed record and log of one run. Root administrators only.
     */
    public function run(UpdateAdminRequest $request, string $run): JsonResponse
    {
        $record = $this->updates->store()->load($run);
        abort_if($record === null, 404);

        return new JsonResponse(['run' => $record, 'log' => $this->updates->store()->readLog($run)]);
    }
}
