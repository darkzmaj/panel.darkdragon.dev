<?php

declare(strict_types=1);

namespace GobiaBackups\Http\Controllers;

use GobiaBackups\Http\ConfirmsPassword;
use GobiaBackups\Models\Restore;
use GobiaBackups\Models\Run;
use GobiaBackups\Services\BackupService;
use GobiaBackups\Services\RestoreService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;
use Pterodactyl\Models\Server;

/** Every offsite backup on the Panel, for administrators: list, start, delete, and restore into any server. */
#[Group('Gobia backups')]
class RunController
{
    use ConfirmsPassword;

    public function __construct(private readonly BackupService $backups, private readonly RestoreService $restores) {}

    #[Endpoint('List offsite backups')]
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'server' => ['sometimes', 'uuid'],
            'state' => ['sometimes', Rule::in([Run::QUEUED, Run::ARCHIVING, Run::UPLOADING, Run::COMPLETED, Run::FAILED, Run::DELETED])],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $page = Run::query()
            ->when(isset($data['server']), fn ($query) => $query->where('server_uuid', $data['server']))
            ->when(isset($data['state']), fn ($query) => $query->where('state', $data['state']), fn ($query) => $query->where('state', '!=', Run::DELETED))
            ->orderByDesc('id')
            ->paginate((int) ($data['per_page'] ?? 50));

        return new JsonResponse([
            'data' => $page->getCollection()->map(fn (Run $run): array => $run->adminSummary())->all(),
            'meta' => ['pagination' => ['total' => $page->total(), 'per_page' => $page->perPage(), 'current_page' => $page->currentPage(), 'total_pages' => $page->lastPage()]],
        ]);
    }

    #[Endpoint('Back up a server now')]
    public function store(Request $request, string $server): JsonResponse
    {
        $model = Server::query()->where('uuid', $server)->firstOrFail();
        $run = $this->backups->request($model, Run::TRIGGER_MANUAL, $request->user());

        return new JsonResponse($run->adminSummary(), 202);
    }

    #[Endpoint('Delete an offsite backup', 'Removes the object from the Storage Box.')]
    public function destroy(string $run): JsonResponse
    {
        $this->backups->delete(Run::query()->where('uuid', $run)->firstOrFail());

        return new JsonResponse([], 204);
    }

    #[Endpoint('Restore an offsite backup', 'Into the server it came from, or into another server (`target`). The current password is required. With `truncate` the server\'s files are removed first.')]
    public function restore(Request $request, string $run): JsonResponse
    {
        $data = $request->validate([
            'target' => ['sometimes', 'nullable', 'uuid'],
            'truncate' => ['sometimes', 'boolean'],
            'password' => ['required', 'string'],
        ]);
        $this->confirmPassword($request, $data['password']);

        $model = Run::query()->where('uuid', $run)->firstOrFail();
        $target = Server::query()->where('uuid', $data['target'] ?? $model->server_uuid)->firstOrFail();
        $restore = $this->restores->request($model, $target, $request->user(), (bool) ($data['truncate'] ?? false));

        return new JsonResponse($restore->summary(), 202);
    }

    #[Endpoint('List restores')]
    public function restores(): JsonResponse
    {
        return new JsonResponse(['data' => Restore::query()->with('run')->orderByDesc('id')->limit(100)->get()->map(fn (Restore $restore): array => $restore->summary())->all()]);
    }
}
