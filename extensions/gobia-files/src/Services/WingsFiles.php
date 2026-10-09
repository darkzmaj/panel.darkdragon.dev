<?php

declare(strict_types=1);

namespace GobiaFiles\Services;

use GuzzleHttp\Psr7\Utils;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Http;
use Psr\Http\Message\ResponseInterface;
use Pterodactyl\Facades\Daemon;
use Pterodactyl\Models\Server;
use Pterodactyl\Services\Daemon\FilesClient;
use Throwable;

/**
 * One server's files on its node, for the transfer service.
 *
 * Folder listings, renames, deletes and folders go through the core client. File bytes do not: the core client holds a
 * file as one PHP string, which is what limited transfers to a few megabytes of memory. Here a file is streamed through
 * `php://temp` (memory up to a few MiB, then a temporary file), so the memory a transfer needs does not depend on the
 * size of the file.
 */
final class WingsFiles
{
    public function __construct(private readonly Server $server) {}

    /** A fresh empty temporary file; the caller deletes it. */
    public static function temp(): string
    {
        $file = tempnam(sys_get_temp_dir(), 'gobia-xfer-');
        if ($file === false) {
            throw new TransferIntegrityException('A temporary file could not be created.');
        }

        return $file;
    }

    /**
     * Size and SHA-256 of a file, read in chunks (nothing is loaded whole).
     *
     * @return array{size: int, sha256: string}
     */
    public static function digest(string $file): array
    {
        clearstatcache(true, $file);

        return ['size' => (int) filesize($file), 'sha256' => (string) hash_file('sha256', $file)];
    }

    public function client(): FilesClient
    {
        return Daemon::server($this->server)->files();
    }

    /**
     * Streams a file from the node into the temporary file `$file` and refuses it as soon as its announced size is above `$limit`.
     */
    public function download(string $path, int $limit, string $file): void
    {
        $guard = function (ResponseInterface $response) use ($limit): void {
            if ((int) $response->getHeaderLine('Content-Length') > $limit) {
                throw new TransferTooLargeException($limit);
            }
        };

        try {
            $this->request()->withOptions(['sink' => $file, 'on_headers' => $guard])->get($this->route('contents', $path))->throw();
        } catch (Throwable $exception) {
            for ($cause = $exception; $cause !== null; $cause = $cause->getPrevious()) {
                if ($cause instanceof TransferTooLargeException) {
                    throw $cause;
                }
            }

            throw $exception;
        }
    }

    /** Streams the temporary file `$file` into a file on the node. */
    public function upload(string $path, string $file): void
    {
        $this->request()->withBody(Utils::streamFor(Utils::tryFopen($file, 'rb')), 'application/octet-stream')->post($this->route('write', $path))->throw();
    }

    private function request(): PendingRequest
    {
        $node = $this->server->node;

        return Http::baseUrl($node->getConnectionAddress())
            ->withToken($node->getDecryptedKey())
            ->acceptJson()
            ->connectTimeout((int) config('pterodactyl.guzzle.connect_timeout'))
            ->timeout((int) config('gobia_files.transfer.timeout'))
            ->withOptions(['verify' => App::isProduction()]);
    }

    private function route(string $action, string $path): string
    {
        return "/api/servers/{$this->server->uuid}/files/{$action}?".http_build_query(['file' => $path]);
    }
}
