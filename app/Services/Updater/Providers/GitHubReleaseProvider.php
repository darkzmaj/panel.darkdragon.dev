<?php

namespace Pterodactyl\Services\Updater\Providers;

use Illuminate\Support\Arr;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Http\Client\PendingRequest;
use Pterodactyl\Services\Updater\ReleaseInfo;
use Illuminate\Http\Client\ConnectionException;
use Pterodactyl\Services\Updater\VersionComparator;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

/**
 * Reads releases from a (possibly private) GitHub repository using a read-only token.
 * The repository comes from configuration, and package downloads only ever use asset ids
 * that GitHub itself returned for that repository.
 */
class GitHubReleaseProvider implements ReleaseProvider
{
    private const API = 'https://api.github.com';

    public function __construct(
        private string $repository,
        private ?string $token,
        private int $maxDownloadBytes,
    ) {
        if (!preg_match('/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/D', $repository)) {
            throw new UpdateException('The configured update repository is invalid.');
        }
    }

    public function latest(): ?ReleaseInfo
    {
        $candidates = $this->candidates();
        $version = collect(array_keys($candidates))
            ->sort(fn (string $a, string $b) => VersionComparator::compare($b, $a))
            ->first();

        return $version === null ? null : $this->build($candidates[$version]);
    }

    public function find(string $version): ?ReleaseInfo
    {
        if (!VersionComparator::isValid($version)) {
            return null;
        }

        $release = $this->candidates()[$version] ?? null;

        return $release === null ? null : $this->build($release);
    }

    public function download(ReleaseInfo $release, string $destination): void
    {
        if (!ctype_digit($release->packageRef)) {
            throw new UpdateException('The release package reference is invalid.');
        }

        try {
            $response = $this->client('application/octet-stream')
                ->timeout(900)
                ->withOptions([
                    'sink' => $destination,
                    'progress' => function ($total, $downloaded) {
                        if ($downloaded > $this->maxDownloadBytes) {
                            throw new UpdateException('The release package is larger than the allowed maximum.');
                        }
                    },
                ])
                ->get(self::API . '/repos/' . $this->repository . '/releases/assets/' . $release->packageRef);
        } catch (ConnectionException $exception) {
            throw new UpdateException('The download was interrupted: the connection to GitHub failed.');
        }

        $this->guard($response, 'downloading the release package');
    }

    /**
     * @return array<string, array>
     */
    private function candidates(): array
    {
        try {
            $response = $this->client()->get(self::API . '/repos/' . $this->repository . '/releases', ['per_page' => 30]);
        } catch (ConnectionException $exception) {
            throw new UpdateException('Could not reach GitHub to check for updates.');
        }

        $this->guard($response, 'listing releases');

        $candidates = [];
        foreach ($response->json() ?? [] as $release) {
            $version = VersionComparator::fromTag((string) Arr::get($release, 'tag_name', ''));
            if ($version === null || Arr::get($release, 'draft') || Arr::get($release, 'prerelease')) {
                continue;
            }

            $assets = collect(Arr::get($release, 'assets', []))->keyBy('name');
            if (!$assets->has('release.json') || !$assets->has('panel-' . $version . '.tar.gz')) {
                continue;
            }

            $candidates[$version] = ['release' => $release, 'assets' => $assets];
        }

        return $candidates;
    }

    private function build(array $candidate): ReleaseInfo
    {
        /** @var \Illuminate\Support\Collection $assets */
        $assets = $candidate['assets'];
        $release = $candidate['release'];
        $version = VersionComparator::fromTag((string) $release['tag_name']);

        try {
            $response = $this->client('application/octet-stream')
                ->timeout(60)
                ->get(self::API . '/repos/' . $this->repository . '/releases/assets/' . $assets['release.json']['id']);
        } catch (ConnectionException $exception) {
            throw new UpdateException('Could not reach GitHub to read the release metadata.');
        }
        $this->guard($response, 'reading the release metadata');

        $meta = json_decode($response->body(), true);
        if (!is_array($meta) || ($meta['version'] ?? null) !== $version || !is_string($meta['sha256'] ?? null)) {
            throw new UpdateException('The release metadata is malformed or does not match the release tag.');
        }

        $package = $assets['panel-' . $version . '.tar.gz'];

        return new ReleaseInfo(
            $version,
            strtolower($meta['sha256']),
            (int) ($meta['size'] ?? 0),
            (bool) ($meta['migrations'] ?? true),
            (bool) ($meta['requires_restart'] ?? true),
            isset($meta['signature']) ? (string) $meta['signature'] : null,
            Arr::get($release, 'published_at'),
            (string) Arr::get($release, 'body', ''),
            (string) $package['id'],
        );
    }

    private function client(string $accept = 'application/vnd.github+json'): PendingRequest
    {
        $client = Http::withHeaders([
            'Accept' => $accept,
            'X-GitHub-Api-Version' => '2022-11-28',
            'User-Agent' => 'gobia-panel-updater',
        ])->timeout(30);

        return $this->token ? $client->withToken($this->token) : $client;
    }

    /**
     * Turns HTTP failures into administrator friendly errors that never include the token.
     */
    private function guard(Response $response, string $action): void
    {
        if ($response->successful()) {
            return;
        }

        $message = match ($response->status()) {
            401 => 'GitHub rejected the update token (401). Check GOBIA_UPDATE_GITHUB_TOKEN.',
            403 => 'GitHub denied access (403): the token lacks permission or the rate limit was reached.',
            404 => 'The update repository was not found. If it is private, GOBIA_UPDATE_GITHUB_TOKEN must grant read access to it.',
            default => 'GitHub returned HTTP ' . $response->status(),
        };

        throw new UpdateException($message . ' (while ' . $action . ')');
    }
}
