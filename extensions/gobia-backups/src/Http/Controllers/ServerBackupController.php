<?php

declare(strict_types=1);

namespace GobiaBackups\Http\Controllers;

use GobiaBackups\Http\ConfirmsPassword;
use GobiaBackups\Models\Restore;
use GobiaBackups\Models\Run;
use GobiaBackups\Services\BackupService;
use GobiaBackups\Services\PolicyResolver;
use GobiaBackups\Services\RestoreService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;
use Pterodactyl\Enum\Permissions;
use Pterodactyl\Models\Server;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Offsite backups of one server, for the people who can open that server. They see their own backups and nothing
 * about where they are kept: destinations, hosts and keys are the administrator's.
 */
#[Group('Gobia backups')]
class ServerBackupController
{
    use ConfirmsPassword;

    public function __construct(
        private readonly BackupService $backups,
        private readonly RestoreService $restores,
        private readonly PolicyResolver $policies,
    ) {}

    #[Endpoint('List a server\'s offsite backups')]
    public function index(Request $request, Server $server): JsonResponse
    {
        $this->authorize($request, $server, Permissions::BackupRead->value);
        $policy = $this->policies->effective($server);

        return new JsonResponse([
            'configured' => $this->policies->destination($server) !== null,
            'schedule' => $policy['enabled'] ? ['cron' => $policy['cron'], 'timezone' => $policy['timezone'], 'keep_last' => $policy['keep_last'], 'keep_days' => $policy['keep_days']] : null,
            'data' => Run::query()->where('server_uuid', $server->uuid)->where('state', '!=', Run::DELETED)->orderByDesc('id')->limit(100)->get()->map(fn (Run $run): array => $run->summary())->all(),
            'restores' => Restore::query()->where('server_id', $server->id)->with('run')->orderByDesc('id')->limit(10)->get()->map(fn (Restore $restore): array => $restore->summary())->all(),
        ]);
    }

    #[Endpoint('Start an offsite backup')]
    public function store(Request $request, Server $server): JsonResponse
    {
        $this->authorize($request, $server, 'ext.gobia-backups.create');

        return new JsonResponse($this->backups->request($server, Run::TRIGGER_MANUAL, $request->user())->summary(), 202);
    }

    #[Endpoint('Restore an offsite backup of this server', 'The current password is required. With `truncate` the server\'s files are removed first.')]
    public function restore(Request $request, Server $server, string $run): JsonResponse
    {
        $this->authorize($request, $server, 'ext.gobia-backups.restore');
        $data = $request->validate(['truncate' => ['sometimes', 'boolean'], 'password' => ['required', 'string']]);
        $this->confirmPassword($request, $data['password']);

        // Only a backup of this very server: restoring someone else's backup is an administrator action.
        $model = Run::query()->where('uuid', $run)->where('server_uuid', $server->uuid)->firstOrFail();

        return new JsonResponse($this->restores->request($model, $server, $request->user(), (bool) ($data['truncate'] ?? false))->summary(), 202);
    }

    private function authorize(Request $request, Server $server, string $permission): void
    {
        throw_unless($request->user()->can($permission, $server), AccessDeniedHttpException::class, 'You do not have permission to do this on this server.');
    }
}
