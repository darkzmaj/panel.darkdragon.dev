<?php

declare(strict_types=1);

namespace GobiaCore\Updater\Providers;

use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\ReleaseInfo;
use GobiaCore\Updater\VersionComparator;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;

/**
 * Reads releases from a (possibly private) GitHub repository using a read-only token.
 * The repository comes from configuration, and package downloads only ever use asset ids
 * that GitHub itself returned for that repository. Only releases tagged `gobia-v<version>`
 * count, so an upstream Pterodactyl tag in the same repository is never offered.
 */
class GitHubReleaseProvider implements ReleaseProvider
{
    private const string API = 'https://api.github.com';

    public function __construct(
        private readonly string $repository,
        private readonly ?string $token,
        private readonly int $maxDownloadBytes,
        private readonly bool $allowPrerelease = false,
    ) {
        if (preg_match('/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/D', $repository) !== 1) {
            throw new UpdateException('The configured update repository is invalid.');
        }
    }

    public function latest(): ?ReleaseInfo
    {
        $candidates = $this->candidates();
        $versions = array_keys($candidates);
        usort($versions, fn (string $a, string $b): int => VersionComparator::compare($b, $a));

        return isset($versions[0]) ? $this->build($candidates[$versions[0]]) : null;
    }

    public function find(string $version): ?ReleaseInfo
    {
        if (! VersionComparator::isValid($version)) {
            return null;
        }

        $release = $this->candidates()[$version] ?? null;

        return $release === null ? null : $this->build($release);
    }

    public function download(ReleaseInfo $release, string $destination): void
    {
        if (! ctype_digit($release->packageRef)) {
            throw new UpdateException('The release package reference is invalid.');
        }

        try {
            $response = $this->client('application/octet-stream')
                ->timeout(900)
                ->withOptions([
                    'sink' => $destination,
                    'progress' => function ($total, $downloaded): void {
                        if ($downloaded > $this->maxDownloadBytes) {
                            throw new UpdateException('The release package is larger than the allowed maximum.');
                        }
                    },
                ])
                ->get(self::API.'/repos/'.$this->repository.'/releases/assets/'.$release->packageRef);
        } catch (ConnectionException) {
            throw new UpdateException('The download was interrupted: the connection to GitHub failed.');
        }

        $this->guard($response, 'downloading the release package');
    }

    /**
     * @return array<string, array{release: array<string, mixed>, assets: array<string, array<string, mixed>>}>
     */
    private function candidates(): array
    {
        try {
            $response = $this->client()->get(self::API.'/repos/'.$this->repository.'/releases', ['per_page' => 30]);
        } catch (ConnectionException) {
            throw new UpdateException('Could not reach GitHub to check for updates.');
        }

        $this->guard($response, 'listing releases');

        $candidates = [];
        foreach ((array) $response->json() as $release) {
            if (! is_array($release)) {
                continue;
            }

            $version = VersionComparator::fromTag((string) Arr::get($release, 'tag_name', ''));
            if ($version === null || Arr::get($release, 'draft') || (! $this->allowPrerelease && (Arr::get($release, 'prerelease') || ! VersionComparator::isStable($version)))) {
                continue;
            }

            $assets = [];
            foreach ((array) Arr::get($release, 'assets', []) as $asset) {
                if (is_array($asset) && is_string($asset['name'] ?? null)) {
                    $assets[$asset['name']] = $asset;
                }
            }

            if (! isset($assets['release.json'], $assets['gobia-panel-'.$version.'.tar.gz'])) {
                continue;
            }

            $candidates[$version] = ['release' => $release, 'assets' => $assets];
        }

        return $candidates;
    }

    /** @param array{release: array<string, mixed>, assets: array<string, array<string, mixed>>} $candidate */
    private function build(array $candidate): ReleaseInfo
    {
        $release = $candidate['release'];
        $version = (string) VersionComparator::fromTag((string) $release['tag_name']);

        try {
            $response = $this->client('application/octet-stream')
                ->timeout(60)
                ->get(self::API.'/repos/'.$this->repository.'/releases/assets/'.(int) $candidate['assets']['release.json']['id']);
        } catch (ConnectionException) {
            throw new UpdateException('Could not reach GitHub to read the release manifest.');
        }
        $this->guard($response, 'reading the release manifest');

        // A manifest is a few kilobytes. Anything large is not one, and is not parsed.
        $body = $response->body();
        $manifest = strlen($body) > 1048576 ? null : json_decode($body, true);
        if (! is_array($manifest) || ($manifest['gobia_version'] ?? null) !== $version) {
            throw new UpdateException('The release manifest is malformed or does not match the release tag.');
        }

        $published = Arr::get($release, 'published_at');

        return ReleaseInfo::fromManifest(
            $manifest,
            is_string($published) ? $published : null,
            (string) Arr::get($release, 'body', ''),
            (string) (int) $candidate['assets']['gobia-panel-'.$version.'.tar.gz']['id'],
        );
    }

    private function client(string $accept = 'application/vnd.github+json'): PendingRequest
    {
        $client = Http::withHeaders([
            'Accept' => $accept,
            'X-GitHub-Api-Version' => '2022-11-28',
            'User-Agent' => 'gobia-panel-updater',
        ])->timeout(30);

        return $this->token !== null && $this->token !== '' ? $client->withToken($this->token) : $client;
    }

    /** Turns HTTP failures into administrator friendly errors that never include the token. */
    private function guard(Response $response, string $action): void
    {
        if ($response->successful()) {
            return;
        }

        $message = match ($response->status()) {
            401 => 'GitHub rejected the update token (401). Check GOBIA_UPDATE_GITHUB_TOKEN.',
            403 => 'GitHub denied access (403): the token lacks permission or the rate limit was reached.',
            404 => 'The update repository was not found. If it is private, GOBIA_UPDATE_GITHUB_TOKEN must grant read access to it.',
            default => 'GitHub returned HTTP '.$response->status(),
        };

        throw new UpdateException($message.' (while '.$action.')');
    }
}
