<?php

declare(strict_types=1);

namespace GobiaTemplates\Services;

use GuzzleHttp\Psr7\Utils;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Http;
use Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\Server;
use Throwable;

/**
 * Streams one large file to a server through Wings without loading it into memory. Small files go through the
 * panel's own file client; the panel client only accepts strings, which is not suitable for multi gigabyte jars.
 */
class DaemonUploader
{
    /** @param resource $stream */
    public function stream(Server $server, string $path, $stream): void
    {
        $node = $server->node instanceof Node ? $server->node : Node::query()->findOrFail($server->node_id);

        try {
            $response = Http::baseUrl($node->getConnectionAddress())
                ->withToken($node->getDecryptedKey())
                ->acceptJson()
                ->timeout(3600)
                ->connectTimeout((int) config('pterodactyl.guzzle.connect_timeout', 5))
                ->withOptions(['verify' => App::isProduction()])
                ->withBody(Utils::streamFor($stream), 'application/octet-stream')
                ->post("/api/servers/{$server->uuid}/files/write?file=".rawurlencode($path));
        } catch (Throwable $exception) {
            throw new DaemonConnectionException($exception);
        }

        if ($response->failed()) {
            throw new DaemonConnectionException(new \RuntimeException('Wings rejected the file upload with status '.$response->status().'.'));
        }
    }
}
