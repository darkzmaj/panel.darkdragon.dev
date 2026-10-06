<?php

namespace AuditProbe\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Pterodactyl\Models\Server;
use Pterodactyl\Services\Extensions\ExtensionJobProgress;
use Pterodactyl\Services\Extensions\ExtensionManager;
use Pterodactyl\Services\Extensions\ExtensionSettingsDefinition;
use Pterodactyl\Services\Extensions\ExtensionSettingsRegistry;

class ProbeController
{
    public function status(): JsonResponse
    {
        return new JsonResponse(['extension' => 'audit-probe', 'status' => 'ok']);
    }

    private function definition(): ExtensionSettingsDefinition
    {
        return app(ExtensionSettingsRegistry::class)->get('audit-probe');
    }

    public function userSetting(Request $request): JsonResponse
    {
        return new JsonResponse(['greeting' => $this->definition()->forUser($request->user())->get('greeting')]);
    }

    public function putUserSetting(Request $request): JsonResponse
    {
        $this->definition()->forUser($request->user())->update(['greeting' => (string) $request->input('greeting')]);

        return new JsonResponse(['ok' => true]);
    }

    public function serverSetting(Request $request, Server $server): JsonResponse
    {
        abort_unless($request->user()->can('ext.audit-probe.view', $server), 403);

        return new JsonResponse(['greeting' => $this->definition()->forServer($server)->get('greeting')]);
    }

    public function items(Request $request, Server $server): JsonResponse
    {
        abort_unless($request->user()->can('ext.audit-probe.view', $server), 403);

        return new JsonResponse(DB::table('audit_probe_items')->where('server_uuid', $server->uuid)->get());
    }

    public function store(Request $request, Server $server): JsonResponse
    {
        abort_unless($request->user()->can('ext.audit-probe.write', $server), 403);
        DB::table('audit_probe_items')->insert(['server_uuid' => $server->uuid, 'label' => (string) $request->input('label', 'x'), 'created_at' => now(), 'updated_at' => now()]);

        return new JsonResponse(['ok' => true], 201);
    }

    public function whoami(Request $request): JsonResponse
    {
        return new JsonResponse(['admin' => (bool) $request->user()->root_admin]);
    }

    public function job(Request $request, ExtensionJobProgress $progress): JsonResponse
    {
        $snap = $progress->begin('audit-probe', $request->user());
        $progress->update('audit-probe', $snap->id, 50, 'half');
        $progress->update('audit-probe', $snap->id, 100, 'done', 'completed');

        return new JsonResponse(['id' => $snap->id]);
    }
}
