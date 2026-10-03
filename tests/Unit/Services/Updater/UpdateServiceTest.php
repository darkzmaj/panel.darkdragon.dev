<?php

namespace Pterodactyl\Tests\Unit\Services\Updater;

use PHPUnit\Framework\Attributes\DataProvider;
use Pterodactyl\Services\Updater\UpdateService;
use Pterodactyl\Services\Updater\ReleaseVerifier;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

class UpdateServiceTest extends UpdaterTestCase
{
    private function service(): UpdateService
    {
        $service = new class ($this->provider, new ReleaseVerifier($this->publicKey), $this->store) extends UpdateService {
            public array $spawned = [];

            protected function spawnWorker(string $runId): void
            {
                $this->spawned[] = $runId;
            }

            protected function spawnRecovery(): void
            {
                $this->spawned[] = 'recovery';
            }
        };

        return $service;
    }

    public function testStartCreatesARunAndStartsExactlyOneWorker(): void
    {
        $this->publish();
        $service = $this->service();

        [$created, $run] = $service->start('1.15.1-gobia.2', ['id' => 1, 'username' => 'root']);

        $this->assertTrue($created);
        $this->assertSame('queued', $run['state']);
        $this->assertSame('1.15.1-gobia.1', $run['from_version']);
        $this->assertSame([$run['id']], $service->spawned);
    }

    public function testSecondStartReturnsTheRunningUpdateInsteadOfStartingAnother(): void
    {
        $this->publish();
        $this->publish('1.15.1-gobia.3');
        $service = $this->service();

        [, $first] = $service->start('1.15.1-gobia.2', null);
        [$created, $second] = $service->start('1.15.1-gobia.3', null);

        $this->assertFalse($created);
        $this->assertSame($first['id'], $second['id']);
        $this->assertCount(1, $service->spawned, 'a double click must not spawn a second worker');
    }

    #[DataProvider('badVersions')]
    public function testInvalidVersionsNeverReachTheProviderOrDisk(string $version): void
    {
        $this->expectException(UpdateException::class);
        $this->expectExceptionMessage('not a valid');

        try {
            $this->service()->start($version, null);
        } finally {
            $this->assertNull($this->store->active());
        }
    }

    public static function badVersions(): array
    {
        return [
            ['../../../../etc/passwd'],
            ['1.15.1-gobia.2/../../x'],
            ['1.15.1-gobia.2; whoami'],
            ['1.15.1-gobia.2' . "\n"],
            ['latest'],
            [''],
            ['1.15.1'],
        ];
    }

    public function testAlreadyCurrentAndOlderVersionsAreRefused(): void
    {
        $this->publish('1.15.1-gobia.1');

        foreach (['1.15.1-gobia.1', '1.14.0-gobia.9'] as $version) {
            try {
                $this->service()->start($version, null);
                $this->fail('Expected an exception for ' . $version);
            } catch (UpdateException $exception) {
                $this->assertStringContainsString('up to date', $exception->getMessage());
            }
        }

        $this->assertNull($this->store->active());
    }

    public function testVersionThatIsNotPublishedIsRefused(): void
    {
        $this->expectExceptionMessage('not published');
        $this->service()->start('1.15.1-gobia.7', null);
    }

    public function testForgedReleaseMetadataIsRefusedAtStart(): void
    {
        [$release] = $this->publish();
        $this->provider->releases[$release->version] = new \Pterodactyl\Services\Updater\ReleaseInfo(
            $release->version,
            $release->sha256,
            $release->size,
            !$release->migrations,
            true,
            $release->signature,
            null,
            '',
            'x'
        );

        $this->expectExceptionMessage('signature');
        $this->service()->start($release->version, null);
    }

    public function testCheckReportsAvailabilityAndIsCached(): void
    {
        $this->publish();
        $service = $this->service();

        $first = $service->check(true);
        $this->provider->releases = [];
        $second = $service->check();

        $this->assertTrue($first['available']);
        $this->assertSame('1.15.1-gobia.2', $second['release']['version'], 'served from the cache without asking the source again');
        $this->assertNull($service->check(true)['release'], 'a manual check refreshes it');
    }

    public function testCheckWhenAlreadyCurrentReportsNoUpdate(): void
    {
        $this->publish('1.15.1-gobia.1');

        $this->assertFalse($this->service()->check(true)['available']);
    }

    public function testFailedChecksReportAnErrorWithoutThrowing(): void
    {
        $this->provider->failWith = 'GitHub rejected the update token (401).';

        $result = $this->service()->check(true);

        $this->assertFalse($result['available']);
        $this->assertStringContainsString('rejected', $result['error']);
    }

    public function testPublicProgressContainsNoSensitiveDetails(): void
    {
        $this->publish();
        $service = $this->service();
        $service->start('1.15.1-gobia.2', ['id' => 7, 'username' => 'secret-admin']);

        $json = json_encode($service->publicProgress());

        $this->assertStringNotContainsString('secret-admin', $json);
        $this->assertStringNotContainsString('1.15.1', $json);
        $this->assertStringNotContainsString($this->state, $json);
        $this->assertTrue($service->publicProgress()['active']);
    }

    public function testStatusOfADeadWorkerTriggersRecovery(): void
    {
        $id = $this->queueRun();
        $run = $this->store->load($id);
        $run['heartbeat'] = time() - 3600;
        $this->store->save($run);
        $service = $this->service();

        $service->status();

        $this->assertSame(['recovery'], $service->spawned);
    }
}
