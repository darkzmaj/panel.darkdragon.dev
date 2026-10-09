<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

use GobiaCore\Updater\Exceptions\UpdateException;

/**
 * One published Gobia release: the signed manifest (`release.json`, a superset of `gobia-release.json`)
 * plus where its package can be fetched. Treat every field as untrusted until {@see ReleaseVerifier}
 * has checked the signature and the downloaded package against it.
 */
final readonly class ReleaseInfo
{
    /**
     * @param  array<string, mixed>  $manifest  the manifest exactly as published
     * @param  string  $packageRef  opaque, provider specific reference used to download the package
     */
    public function __construct(
        public array $manifest,
        public ?string $publishedAt,
        public string $notes,
        public string $packageRef,
    ) {}

    /**
     * @param  array<string, mixed>  $manifest
     *
     * @throws UpdateException when the manifest does not even have the shape of one
     */
    public static function fromManifest(array $manifest, ?string $publishedAt, string $notes, string $packageRef): self
    {
        if (! VersionComparator::isValid($manifest['gobia_version'] ?? null) || ! is_array($manifest['artifact'] ?? null)) {
            throw new UpdateException('The release manifest is malformed.');
        }

        return new self($manifest, $publishedAt, $notes, $packageRef);
    }

    public function version(): string
    {
        return (string) $this->manifest['gobia_version'];
    }

    public function sha256(): string
    {
        return strtolower((string) ($this->manifest['artifact']['sha256'] ?? ''));
    }

    public function size(): int
    {
        return (int) ($this->manifest['artifact']['size'] ?? 0);
    }

    public function packageName(): string
    {
        return 'gobia-panel-'.$this->version().'.tar.gz';
    }

    public function signature(): ?string
    {
        $signature = $this->manifest['signature'] ?? null;

        return is_string($signature) && $signature !== '' ? $signature : null;
    }

    public function baseVersion(): string
    {
        return (string) ($this->manifest['pterodactyl_base']['version'] ?? 'unknown');
    }

    public function baseCommit(): ?string
    {
        $commit = $this->manifest['pterodactyl_base']['commit'] ?? null;

        return is_string($commit) ? $commit : null;
    }

    /** The extension API version the release ships (config extensions.sdk_version of that release). */
    public function sdkVersion(): ?string
    {
        $version = $this->manifest['pterodactyl_base']['sdk'] ?? null;

        return is_string($version) ? $version : null;
    }

    /** @return array<string, string> bundled Gobia extension id => version */
    public function extensions(): array
    {
        $extensions = [];
        foreach ((array) ($this->manifest['extensions'] ?? []) as $id => $version) {
            if (is_string($id) && preg_match('/^[a-z0-9][a-z0-9-]{0,62}$/D', $id) === 1 && is_string($version)) {
                $extensions[$id] = $version;
            }
        }

        return $extensions;
    }

    /** @return list<string> every migration the release contains, core and bundled extensions */
    public function migrationNames(): array
    {
        return array_values(array_filter((array) ($this->manifest['migrations']['names'] ?? []), is_string(...)));
    }

    public function destructive(): bool
    {
        return (bool) ($this->manifest['migrations']['destructive'] ?? false);
    }

    public function minUpgradeFrom(): ?string
    {
        $minimum = $this->manifest['min_upgrade_from'] ?? null;

        return is_string($minimum) ? $minimum : null;
    }

    public function phpConstraint(): ?string
    {
        $constraint = $this->manifest['php'] ?? null;

        return is_string($constraint) ? $constraint : null;
    }

    public function securityUpdate(): bool
    {
        return (bool) ($this->manifest['security_update'] ?? false);
    }

    public function nodeRuntimeRequired(): bool
    {
        return (bool) ($this->manifest['node_runtime_required'] ?? false);
    }

    /** @return list<string> e.g. ["mariadb>=10.5", "mysql>=8.0"] */
    public function databaseServers(): array
    {
        return array_values(array_filter((array) ($this->manifest['database']['server'] ?? []), is_string(...)));
    }

    /** @return array<string, mixed> */
    public function toCache(): array
    {
        return ['manifest' => $this->manifest, 'published_at' => $this->publishedAt, 'notes' => $this->notes, 'package_ref' => $this->packageRef];
    }

    /** @param array<string, mixed> $data */
    public static function fromCache(array $data): self
    {
        return self::fromManifest((array) ($data['manifest'] ?? []), $data['published_at'] ?? null, (string) ($data['notes'] ?? ''), (string) ($data['package_ref'] ?? ''));
    }
}
