<?php

namespace Pterodactyl\Services\Updater\Providers;

use Pterodactyl\Services\Updater\ReleaseInfo;
use Pterodactyl\Services\Updater\VersionComparator;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

/**
 * Reads releases from a local folder laid out as <dir>/<version>/{release.json,panel-<version>.tar.gz,notes.md}.
 * Used for development and tests so the whole update flow can run without GitHub.
 */
class DirectoryReleaseProvider implements ReleaseProvider
{
    public function __construct(private string $directory)
    {
    }

    public function latest(): ?ReleaseInfo
    {
        $versions = [];
        foreach (is_dir($this->directory) ? scandir($this->directory) : [] as $entry) {
            if (VersionComparator::isValid($entry)) {
                $versions[] = $entry;
            }
        }
        usort($versions, fn (string $a, string $b) => VersionComparator::compare($b, $a));

        return isset($versions[0]) ? $this->find($versions[0]) : null;
    }

    public function find(string $version): ?ReleaseInfo
    {
        if (!VersionComparator::isValid($version) || !is_file($this->directory . '/' . $version . '/release.json')) {
            return null;
        }

        $meta = json_decode((string) file_get_contents($this->directory . '/' . $version . '/release.json'), true);
        if (!is_array($meta) || ($meta['version'] ?? null) !== $version || !is_string($meta['sha256'] ?? null)) {
            throw new UpdateException('The release metadata is malformed or does not match the release.');
        }

        $notes = $this->directory . '/' . $version . '/notes.md';

        return new ReleaseInfo(
            $version,
            strtolower($meta['sha256']),
            (int) ($meta['size'] ?? 0),
            (bool) ($meta['migrations'] ?? true),
            (bool) ($meta['requires_restart'] ?? true),
            isset($meta['signature']) ? (string) $meta['signature'] : null,
            gmdate('c', (int) filemtime($this->directory . '/' . $version . '/release.json')),
            is_file($notes) ? (string) file_get_contents($notes) : '',
            'panel-' . $version . '.tar.gz',
        );
    }

    public function download(ReleaseInfo $release, string $destination): void
    {
        // The reference is always generated from a validated version, but check again before touching the disk.
        $source = $this->directory . '/' . $release->version . '/panel-' . $release->version . '.tar.gz';
        if (!VersionComparator::isValid($release->version) || $release->packageRef !== basename($source) || !is_file($source)) {
            throw new UpdateException('The release package is not available.');
        }

        if (!@copy($source, $destination)) {
            throw new UpdateException('The release package could not be copied.');
        }
    }
}
