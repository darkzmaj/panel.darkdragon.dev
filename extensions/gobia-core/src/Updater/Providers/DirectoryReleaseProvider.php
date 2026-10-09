<?php

declare(strict_types=1);

namespace GobiaCore\Updater\Providers;

use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\ReleaseInfo;
use GobiaCore\Updater\VersionComparator;

/**
 * Reads releases from a local folder laid out as <dir>/<version>/{release.json,gobia-panel-<version>.tar.gz,notes.md}.
 * Used for development, tests and air gapped installs so the whole update flow can run without GitHub.
 */
class DirectoryReleaseProvider implements ReleaseProvider
{
    public function __construct(private readonly string $directory, private readonly bool $allowPrerelease = false) {}

    public function latest(): ?ReleaseInfo
    {
        $versions = [];
        foreach (is_dir($this->directory) ? (scandir($this->directory) ?: []) : [] as $entry) {
            if (VersionComparator::isValid($entry) && ($this->allowPrerelease || VersionComparator::isStable($entry))) {
                $versions[] = $entry;
            }
        }
        usort($versions, fn (string $a, string $b): int => VersionComparator::compare($b, $a));

        return isset($versions[0]) ? $this->find($versions[0]) : null;
    }

    public function find(string $version): ?ReleaseInfo
    {
        $file = $this->directory.'/'.$version.'/release.json';
        if (! VersionComparator::isValid($version) || ! is_file($file)) {
            return null;
        }

        $manifest = json_decode((string) file_get_contents($file), true);
        if (! is_array($manifest) || ($manifest['gobia_version'] ?? null) !== $version) {
            throw new UpdateException('The release manifest is malformed or does not match the release.');
        }

        $notes = $this->directory.'/'.$version.'/notes.md';
        $release = ReleaseInfo::fromManifest($manifest, gmdate('c', (int) filemtime($file)), is_file($notes) ? (string) file_get_contents($notes) : '', '');

        return new ReleaseInfo($release->manifest, $release->publishedAt, $release->notes, $release->packageName());
    }

    public function download(ReleaseInfo $release, string $destination): void
    {
        // The reference is always generated from a validated version, but check again before touching the disk.
        $source = $this->directory.'/'.$release->version().'/'.$release->packageName();
        if (! VersionComparator::isValid($release->version()) || $release->packageRef !== basename($source) || ! is_file($source)) {
            throw new UpdateException('The release package is not available.');
        }

        if (! @copy($source, $destination)) {
            throw new UpdateException('The release package could not be copied.');
        }
    }
}
