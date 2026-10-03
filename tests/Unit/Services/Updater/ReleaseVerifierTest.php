<?php

namespace Pterodactyl\Tests\Unit\Services\Updater;

use Pterodactyl\Services\Updater\ReleaseInfo;
use Pterodactyl\Services\Updater\ReleaseVerifier;
use Pterodactyl\Services\Updater\Exceptions\ReleaseVerificationException;

class ReleaseVerifierTest extends UpdaterTestCase
{
    private function release(): ReleaseInfo
    {
        return $this->sign('1.15.1-gobia.2', hash('sha256', 'package'), 7);
    }

    public function testValidSignedReleasePasses(): void
    {
        (new ReleaseVerifier($this->publicKey))->verifyMetadata($this->release());
        $this->assertTrue(true);
    }

    public function testForgedMigrationFlagIsDetected(): void
    {
        $real = $this->release();
        $forged = new ReleaseInfo($real->version, $real->sha256, $real->size, !$real->migrations, $real->requiresRestart, $real->signature, null, '', 'x');

        $this->expectException(ReleaseVerificationException::class);
        (new ReleaseVerifier($this->publicKey))->verifyMetadata($forged);
    }

    public function testForgedChecksumIsDetected(): void
    {
        $real = $this->release();
        $forged = new ReleaseInfo($real->version, hash('sha256', 'evil'), $real->size, $real->migrations, $real->requiresRestart, $real->signature, null, '', 'x');

        $this->expectException(ReleaseVerificationException::class);
        (new ReleaseVerifier($this->publicKey))->verifyMetadata($forged);
    }

    public function testForgedVersionIsDetected(): void
    {
        $real = $this->release();
        $forged = new ReleaseInfo('1.15.1-gobia.9', $real->sha256, $real->size, $real->migrations, $real->requiresRestart, $real->signature, null, '', 'x');

        $this->expectException(ReleaseVerificationException::class);
        (new ReleaseVerifier($this->publicKey))->verifyMetadata($forged);
    }

    public function testMissingSignatureIsRejectedWhenAKeyIsConfigured(): void
    {
        $real = $this->release();
        $unsigned = new ReleaseInfo($real->version, $real->sha256, $real->size, $real->migrations, $real->requiresRestart, null, null, '', 'x');

        $this->expectException(ReleaseVerificationException::class);
        (new ReleaseVerifier($this->publicKey))->verifyMetadata($unsigned);
    }

    public function testSignatureFromAnotherKeyIsRejected(): void
    {
        $otherKey = base64_encode(sodium_crypto_sign_publickey(sodium_crypto_sign_keypair()));

        $this->expectException(ReleaseVerificationException::class);
        (new ReleaseVerifier($otherKey))->verifyMetadata($this->release());
    }

    public function testMalformedChecksumIsRejected(): void
    {
        $this->expectException(ReleaseVerificationException::class);
        (new ReleaseVerifier(null))->verifyMetadata(new ReleaseInfo('1.15.1-gobia.2', 'not-a-sha', 10, true, true, null, null, '', 'x'));
    }

    public function testChecksumOnlyModeStillValidatesTheMetadata(): void
    {
        (new ReleaseVerifier(null))->verifyMetadata(new ReleaseInfo('1.15.1-gobia.2', hash('sha256', 'a'), 10, true, true, null, null, '', 'x'));
        $this->assertTrue(true);
    }

    public function testPackageChecksumMismatchIsRejected(): void
    {
        file_put_contents($file = $this->state . '/p.tar.gz', 'tampered!');
        $release = $this->sign('1.15.1-gobia.2', hash('sha256', 'package'), 9);

        $this->expectException(ReleaseVerificationException::class);
        $this->expectExceptionMessage('SHA-256 mismatch');
        (new ReleaseVerifier($this->publicKey))->verifyPackage($file, $release);
    }

    public function testTruncatedPackageIsRejectedBySize(): void
    {
        file_put_contents($file = $this->state . '/p.tar.gz', 'pack');
        $release = $this->sign('1.15.1-gobia.2', hash('sha256', 'package'), 7);

        $this->expectException(ReleaseVerificationException::class);
        $this->expectExceptionMessage('truncated');
        (new ReleaseVerifier($this->publicKey))->verifyPackage($file, $release);
    }

    public function testMatchingPackagePasses(): void
    {
        file_put_contents($file = $this->state . '/p.tar.gz', 'package');
        (new ReleaseVerifier($this->publicKey))->verifyPackage($file, $this->sign('1.15.1-gobia.2', hash('sha256', 'package'), 7));
        $this->assertTrue(true);
    }
}
