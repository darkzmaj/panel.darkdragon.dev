<?php

declare(strict_types=1);

namespace GobiaBackups\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Psr\Http\Message\StreamInterface;
use Pterodactyl\Enum\JwtScope;
use Pterodactyl\Models\Backup;
use Pterodactyl\Models\Server;
use Pterodactyl\Services\Nodes\NodeJWTService;
use RuntimeException;

/**
 * Opens the archive Wings built for a backup as a stream, the same way a person downloads a backup: a short
 * lived token signed with the node's key. Nothing is buffered; the caller reads it piece by piece.
 */
class WingsArchive
{
    public function __construct(private readonly NodeJWTService $jwt) {}

    public function open(Server $server, Backup $backup): StreamInterface
    {
        $token = $this->jwt
            ->setExpiresAt(CarbonImmutable::now()->addMinutes(15))
            ->setClaims(['backup_uuid' => $backup->uuid, 'server_uuid' => $server->uuid])
            ->setScopes(JwtScope::BackupDownload)
            ->handle($server->node, 'gobia-backups'.$server->uuid.Str::random(16));

        $response = Http::withOptions(['stream' => true, 'verify' => App::isProduction()])
            ->connectTimeout((int) config('pterodactyl.guzzle.connect_timeout', 5))
            ->timeout((int) config('gobia_backups.transfer_timeout'))
            ->get($server->node->getConnectionAddress().'/download/backup', ['token' => $token->toString()]);

        if (! $response->successful()) {
            throw new RuntimeException('The node refused to hand out the archive (HTTP '.$response->status().').');
        }

        return $response->toPsrResponse()->getBody();
    }
}
