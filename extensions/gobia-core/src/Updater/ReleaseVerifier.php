<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

use GobiaCore\Updater\Exceptions\ReleaseVerificationException;

class ReleaseVerifier
{
    /**
     * @param  string|null  $publicKey  base64 Ed25519 public key of the release pipeline
     * @param  bool  $allowUnsigned  development only: accept releases without a signature (the checksum still applies)
     */
    public function __construct(private readonly ?string $publicKey, private readonly bool $allowUnsigned = false) {}

    /**
     * Checks that the release manifest is well formed and was signed by the release pipeline.
     *
     * @throws ReleaseVerificationException
     */
    public function verifyMetadata(ReleaseInfo $release): void
    {
        $this->verifyChecksumFormat($release);
        $this->verifySignature($release);
    }

    /** @throws ReleaseVerificationException */
    public function verifyChecksumFormat(ReleaseInfo $release): void
    {
        if (! VersionComparator::isValid($release->version())) {
            throw new ReleaseVerificationException('The release version is invalid.');
        }

        if (preg_match('/^[a-f0-9]{64}$/D', $release->sha256()) !== 1) {
            throw new ReleaseVerificationException('The release checksum is malformed.');
        }

        if ($release->size() <= 0) {
            throw new ReleaseVerificationException('The release size is missing.');
        }
    }

    /** @throws ReleaseVerificationException */
    public function verifySignature(ReleaseInfo $release): void
    {
        if ($this->allowUnsigned && $release->signature() === null) {
            return;
        }

        if ($this->publicKey === null || $this->publicKey === '') {
            throw new ReleaseVerificationException('No release public key is configured (GOBIA_UPDATE_PUBLIC_KEY), so releases cannot be trusted.');
        }

        $key = base64_decode($this->publicKey, true);
        $signature = $release->signature() === null ? false : base64_decode($release->signature(), true);

        if ($key === false || strlen($key) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
            throw new ReleaseVerificationException('The configured release public key is invalid.');
        }

        if ($signature === false || strlen($signature) !== SODIUM_CRYPTO_SIGN_BYTES
            || ! sodium_crypto_sign_verify_detached($signature, ReleaseSignature::message($release->manifest), $key)) {
            throw new ReleaseVerificationException('The release signature is missing or invalid. The release was not signed by the trusted key.');
        }
    }

    /**
     * Checks a downloaded package against the (already verified) manifest.
     *
     * @throws ReleaseVerificationException
     */
    public function verifyPackage(string $path, ReleaseInfo $release): void
    {
        if (! is_file($path)) {
            throw new ReleaseVerificationException('The downloaded package is missing.');
        }

        $size = filesize($path);
        if ($size !== $release->size()) {
            throw new ReleaseVerificationException(sprintf('The downloaded package is %d bytes but %d were expected. The download may be truncated.', (int) $size, $release->size()));
        }

        if (! hash_equals($release->sha256(), (string) hash_file('sha256', $path))) {
            throw new ReleaseVerificationException('SHA-256 mismatch: the downloaded package does not match the published checksum.');
        }
    }
}
