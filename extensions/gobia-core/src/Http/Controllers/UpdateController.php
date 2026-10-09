<?php

declare(strict_types=1);

namespace GobiaCore\Http\Controllers;

use GobiaCore\Updater\Exceptions\PreflightFailedException;
use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\Exceptions\UpdateInProgressException;
use GobiaCore\Updater\UpdateService;
use GobiaCore\Updater\VersionComparator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;
use Pterodactyl\Facades\Activity;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The Gobia Updates API (docs/gobia-updates-frontend-contract.md). Root administrators only; the two
 * actions that change the installation also require a panel session. The browser sends a version or
 * a run id and nothing else: no URL, path or command is ever accepted.
 */
#[Group('Gobia admin')]
class UpdateController
{
    public function __construct(private readonly UpdateService $updates) {}

    #[Endpoint('Check for updates', 'Installed versions and the latest approved Gobia release. Pass refresh=1 to ask the update source again.')]
    public function check(Request $request): JsonResponse
    {
        return new JsonResponse($this->updates->check($request->boolean('refresh')) + ['active_update_id' => $this->updates->activeId()]);
    }

    #[Endpoint('Update preflight', 'Every local check that must pass before the available release may be installed.')]
    public function preflight(): JsonResponse
    {
        $report = $this->updates->preflight();

        return new JsonResponse($report ?? ['ready' => false, 'target' => null, 'checks' => [], 'extensions' => [], 'migrations' => ['pending' => 0, 'destructive' => false, 'rollback' => 'file-only']]);
    }

    #[Endpoint('Install the available update')]
    public function install(Request $request): JsonResponse
    {
        $data = $request->validate([
            'target' => ['required', 'string', 'regex:'.VersionComparator::PATTERN],
            'confirm_backup' => ['required', 'accepted'],
        ]);

        try {
            $run = $this->updates->start($data['target'], $this->initiator($request));
        } catch (UpdateInProgressException $exception) {
            return $this->error(409, 'update_in_progress', $exception->getMessage(), ['update_id' => $exception->updateId]);
        } catch (PreflightFailedException $exception) {
            $failing = array_values(array_filter($exception->report['checks'], fn (array $check): bool => $check['required'] && $check['status'] !== 'pass'));

            return $this->error(422, 'preflight_failed', $exception->getMessage(), ['checks' => $failing], 'preflight');
        } catch (UpdateException $exception) {
            return $this->error(422, 'update_rejected', $exception->getMessage());
        }

        Activity::event('gobia:update.started')->property(['update_id' => $run['id'], 'from' => $run['from_version'], 'to' => $run['to_version']])->log();

        return new JsonResponse(['update_id' => $run['id']], 202);
    }

    #[Endpoint('Update progress')]
    public function progress(string $update): JsonResponse
    {
        return new JsonResponse($this->updates->progress($update) ?? throw new NotFoundHttpException('Unknown update.'));
    }

    #[Endpoint('Update history')]
    public function history(): JsonResponse
    {
        return new JsonResponse(['data' => $this->updates->history()]);
    }

    #[Endpoint('Rollback eligibility', 'Whether the last update can be undone, and whether that restores the database.')]
    public function rollbackEligibility(): JsonResponse
    {
        return new JsonResponse($this->updates->rollbackEligibility());
    }

    #[Endpoint('Roll back the last update')]
    public function rollback(Request $request): JsonResponse
    {
        $data = $request->validate([
            'update_id' => ['required', 'string', 'max:40'],
            'confirm_database_restore' => ['sometimes', 'boolean'],
        ]);

        try {
            $run = $this->updates->startRollback($data['update_id'], (bool) ($data['confirm_database_restore'] ?? false), $this->initiator($request));
        } catch (UpdateInProgressException $exception) {
            return $this->error(409, 'update_in_progress', $exception->getMessage(), ['update_id' => $exception->updateId]);
        } catch (UpdateException $exception) {
            return $this->error(422, 'rollback_rejected', $exception->getMessage());
        }

        Activity::event('gobia:update.rollback-started')->property(['update_id' => $run['id'], 'rolls_back' => $data['update_id'], 'from' => $run['from_version'], 'to' => $run['to_version']])->log();

        return new JsonResponse(['update_id' => $run['id']], 202);
    }

    /** @return array{type: string, id: int|null, username: string|null, ip: string|null} */
    private function initiator(Request $request): array
    {
        $user = $request->user();

        return ['type' => 'admin', 'id' => $user?->id, 'username' => $user?->username, 'ip' => $request->ip()];
    }

    /**
     * The panel's error envelope, with the contract's structured {code, message, step} beside it.
     *
     * @param  array<string, mixed>  $meta
     */
    private function error(int $status, string $code, string $message, array $meta = [], ?string $step = null): JsonResponse
    {
        return new JsonResponse([
            'errors' => [['code' => $code, 'status' => (string) $status, 'detail' => $message, 'meta' => (object) $meta]],
            'code' => $code,
            'message' => $message,
            'step' => $step,
        ] + $meta, $status);
    }
}
