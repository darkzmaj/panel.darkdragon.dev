<?php

namespace Pterodactyl\Services\Updater;

/**
 * Metadata describing one published release. Treat every field as untrusted until
 * {@see ReleaseVerifier} has checked the signature and the downloaded package against it.
 */
final class ReleaseInfo
{
    public function __construct(
        public readonly string $version,
        public readonly string $sha256,
        public readonly int $size,
        public readonly bool $migrations,
        public readonly bool $requiresRestart,
        public readonly ?string $signature,
        public readonly ?string $publishedAt,
        public readonly string $notes,
        // Opaque, provider specific reference used to download the package (an asset id or a file name).
        public readonly string $packageRef,
    ) {
    }

    /**
     * The exact byte string that is signed by the release pipeline. Covering the size and flags
     * means a forged "no migrations" or a swapped package cannot go undetected.
     */
    public function signedMessage(): string
    {
        return implode('|', [
            'gobia-release-v1',
            $this->version,
            $this->sha256,
            $this->size,
            $this->migrations ? 'migrations' : 'no-migrations',
            $this->requiresRestart ? 'restart' : 'no-restart',
        ]);
    }

    public function toArray(): array
    {
        return [
            'version' => $this->version,
            'size' => $this->size,
            'migrations' => $this->migrations,
            'requires_restart' => $this->requiresRestart,
            'published_at' => $this->publishedAt,
            'notes' => $this->notes,
        ];
    }

    public static function fromArray(array $data): self
    {
        return new self(
            (string) $data['version'],
            (string) ($data['sha256'] ?? ''),
            (int) ($data['size'] ?? 0),
            (bool) ($data['migrations'] ?? true),
            (bool) ($data['requires_restart'] ?? true),
            isset($data['signature']) ? (string) $data['signature'] : null,
            isset($data['published_at']) ? (string) $data['published_at'] : null,
            (string) ($data['notes'] ?? ''),
            (string) ($data['package_ref'] ?? ''),
        );
    }
}
