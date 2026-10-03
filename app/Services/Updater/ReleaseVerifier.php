<?php

namespace Pterodactyl\Services\Updater;

use Pterodactyl\Services\Updater\Exceptions\ReleaseVerificationException;

class ReleaseVerifier
{
    /**
     * @param string|null $publicKey base64 Ed25519 public key; when null only the checksum is enforced
     */
    public function __construct(private ?string $publicKey)
    {
    }

    /**
     * Checks that the release metadata is well formed and, when a public key is configured,
     * that it was signed by the release pipeline.
     *
     * @throws ReleaseVerificationException
     */
    public function verifyMetadata(ReleaseInfo $release): void
    {
        if (!VersionComparator::isValid($release->version)) {
            throw new ReleaseVerificationException('The release version is invalid.');
        }

        if (!preg_match('/^[a-f0-9]{64}$/D', $release->sha256)) {
            throw new ReleaseVerificationException('The release checksum is malformed.');
        }

        if ($release->size <= 0) {
            throw new ReleaseVerificationException('The release size is missing.');
        }

        if (empty($this->publicKey)) {
            return;
        }

        $key = base64_decode($this->publicKey, true);
        $signature = $release->signature === null ? false : base64_decode($release->signature, true);

        if ($key === false || strlen($key) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
            throw new ReleaseVerificationException('The configured release public key is invalid.');
        }

        if ($signature === false || strlen($signature) !== SODIUM_CRYPTO_SIGN_BYTES
            || !sodium_crypto_sign_verify_detached($signature, $release->signedMessage(), $key)) {
            throw new ReleaseVerificationException('The release signature is missing or invalid. The release was not signed by the trusted key.');
        }
    }

    /**
     * Checks a downloaded package against the (already verified) metadata.
     *
     * @throws ReleaseVerificationException
     */
    public function verifyPackage(string $path, ReleaseInfo $release): void
    {
        if (!is_file($path)) {
            throw new ReleaseVerificationException('The downloaded package is missing.');
        }

        $size = filesize($path);
        if ($size !== $release->size) {
            throw new ReleaseVerificationException(sprintf('The downloaded package is %d bytes but %d were expected. The download may be truncated.', $size, $release->size));
        }

        $actual = hash_file('sha256', $path);
        if (!hash_equals($release->sha256, $actual)) {
            throw new ReleaseVerificationException('SHA-256 mismatch: the downloaded package does not match the published checksum.');
        }
    }
}
