<?php

namespace Pterodactyl\Tests\Unit\Services\Updater;

use Pterodactyl\Services\Updater\ProcessResult;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;
use Pterodactyl\Tests\Unit\Services\Updater\Support\TarBuilder;

class UpdateOrchestratorTest extends UpdaterTestCase
{
    private function go(string $to = '1.15.1-gobia.2'): array
    {
        return $this->orchestrator()->execute($this->queueRun($to));
    }

    private function assertFailedAt(array $run, string $stage): void
    {
        $this->assertSame('failed', $run['state']);
        $this->assertSame($stage, $run['failure_stage']);
        $this->assertNotEmpty($run['error']);
    }

    public function testSuccessfulUpdateRunsEveryStageInOrder(): void
    {
        $this->publish();

        $run = $this->go();

        $this->assertSame('success', $run['result']);
        $this->assertSame('completed', $run['state']);
        $this->assertSame(['done'], array_values(array_unique(array_column($run['steps'], 'status'))));
        $this->assertSame(
            ['artisan:down', 'install', 'artisan:migrate', 'artisan:optimize:clear', 'restartWorkers', 'artisan:gobia:update:health', 'artisan:up'],
            $this->runner->calls
        );
        $this->assertSame(['create'], $this->backup->calls);
        $this->assertNull($this->store->active());
        $this->assertNotEmpty($run['finished_at']);
        $this->assertStringContainsString('Update to 1.15.1-gobia.2 completed', $this->store->readLog($run['id']));
    }

    public function testWrongChecksumIsRefusedBeforeAnythingIsInstalled(): void
    {
        [$release, $package] = $this->publish();
        $this->provider->packages[$release->version] = substr($package, 0, -1) . 'X';

        $run = $this->go();

        $this->assertFailedAt($run, 'verify');
        $this->assertStringContainsString('SHA-256 mismatch', $run['error']);
        $this->assertSame([], $this->runner->calls);
        $this->assertSame([], $this->backup->calls);
        $this->assertSame('not-needed', $run['rollback']['result']);
    }

    public function testTruncatedDownloadIsRefused(): void
    {
        [, $package] = $this->publish();
        $this->provider->truncateTo = (string) (int) (strlen($package) / 2);

        $run = $this->go();

        $this->assertFailedAt($run, 'verify');
        $this->assertStringContainsString('truncated', $run['error']);
        $this->assertSame([], $this->runner->calls);
    }

    public function testForgedMetadataIsRefused(): void
    {
        [$release] = $this->publish(migrations: true);
        // An attacker flips the flags and keeps the original signature.
        $this->provider->releases[$release->version] = new \Pterodactyl\Services\Updater\ReleaseInfo(
            $release->version,
            $release->sha256,
            $release->size,
            false,
            $release->requiresRestart,
            $release->signature,
            null,
            '',
            'x'
        );

        $run = $this->go();

        $this->assertFailedAt($run, 'check');
        $this->assertStringContainsString('signature', $run['error']);
        $this->assertSame([], $this->runner->calls);
    }

    public function testPackageContainingTheWrongVersionIsRefused(): void
    {
        $this->publish('1.15.1-gobia.2', ['VERSION' => "1.15.1-gobia.9\n"]);

        $run = $this->go();

        $this->assertFailedAt($run, 'extract');
        $this->assertStringContainsString('different version', $run['error']);
        $this->assertSame([], $this->runner->calls);
    }

    public function testIncompletePackageIsRefused(): void
    {
        $tar = (new TarBuilder())->file('VERSION', "1.15.1-gobia.2\n")->file('artisan', '<?php');
        $this->register('1.15.1-gobia.2', $tar->build());

        $run = $this->go();

        $this->assertFailedAt($run, 'extract');
        $this->assertStringContainsString('incomplete', $run['error']);
    }

    public function testMalformedArtifactIsRefused(): void
    {
        $this->register('1.15.1-gobia.2', 'definitely not a tarball');

        $run = $this->go();

        $this->assertFailedAt($run, 'extract');
        $this->assertSame([], $this->runner->calls);
    }

    public function testPackageTryingToEscapeIsRefused(): void
    {
        $this->register('1.15.1-gobia.2', (new TarBuilder())->file('VERSION', "1.15.1-gobia.2\n")->file('../../outside.php', '<?php')->build());

        $run = $this->go();

        $this->assertFailedAt($run, 'extract');
        $this->assertStringContainsString('traversal', $run['error']);
        $this->assertFileDoesNotExist($this->state . '/../outside.php');
    }

    public function testBackupFailureAbortsBeforeMaintenanceOrInstall(): void
    {
        $this->publish();
        $this->backup->failCreate = true;

        $run = $this->go();

        $this->assertFailedAt($run, 'backup');
        $this->assertStringContainsString('backup failed', $run['error']);
        $this->assertSame([], $this->runner->calls, 'no maintenance mode, no install');
        $this->assertSame([], array_diff($this->backup->calls, ['create']), 'nothing is restored');
        $this->assertSame('not-needed', $run['rollback']['result']);
    }

    public function testMigrationFailureRestoresFilesAndDatabaseAndLeavesMaintenanceMode(): void
    {
        $this->publish();
        $this->runner->artisanResults['migrate'] = new ProcessResult(1, '', 'SQLSTATE[42S01]: Base table or view already exists');

        $run = $this->go();

        $this->assertFailedAt($run, 'migrate');
        $this->assertSame('rolled_back', $run['result']);
        $this->assertSame('success', $run['rollback']['result']);
        $this->assertSame(['create', 'restore'], $this->backup->calls, 'the pre-update dump is restored');
        $this->assertSame(['artisan:down', 'install', 'artisan:migrate', 'restoreFiles', 'artisan:optimize:clear', 'artisan:up'], $this->runner->calls);
        $this->assertFalse($run['flags']['maintenance']);
    }

    public function testInstallFailureRestoresFilesButNotTheDatabase(): void
    {
        $this->publish();
        $this->runner->failInstall = true;

        $run = $this->go();

        $this->assertFailedAt($run, 'install');
        $this->assertSame('rolled_back', $run['result']);
        $this->assertSame(['create'], $this->backup->calls, 'migrations never ran, so the database is untouched');
        $this->assertContains('restoreFiles', $this->runner->calls);
        $this->assertSame('artisan:up', end($this->runner->calls));
    }

    public function testHealthCheckFailureRollsBackEverything(): void
    {
        $this->publish();
        $this->runner->artisanResults['gobia:update:health'] = new ProcessResult(1, json_encode(['ok' => false, 'checks' => [['name' => 'migrations', 'ok' => false, 'detail' => '2 pending']]]), '');

        $run = $this->go();

        $this->assertFailedAt($run, 'health');
        $this->assertStringContainsString('migrations: 2 pending', $run['error']);
        $this->assertSame('rolled_back', $run['result']);
        $this->assertSame(['create', 'restore'], $this->backup->calls);
    }

    public function testHttpHealthProbeFailureRollsBack(): void
    {
        $this->publish();
        $this->probe->fail = true;

        $run = $this->go();

        $this->assertFailedAt($run, 'health');
        $this->assertSame('rolled_back', $run['result']);
        $this->assertContains('restoreFiles', $this->runner->calls);
    }

    public function testFailedRollbackKeepsMaintenanceModeAndSaysSo(): void
    {
        $this->publish();
        $this->runner->artisanResults['migrate'] = new ProcessResult(1, '', 'boom');
        $this->backup->failRestore = true;

        $run = $this->go();

        $this->assertSame('rollback_failed', $run['result']);
        $this->assertSame('failed', $run['rollback']['result']);
        $this->assertTrue($run['flags']['maintenance'], 'a half restored panel must not be served');
        $this->assertNotContains('artisan:up', $this->runner->calls);
        $this->assertStringContainsString('ROLLBACK FAILED', $this->store->readLog($run['id']));
    }

    public function testDowngradeAndCurrentVersionAreRefused(): void
    {
        $this->publish('1.15.1-gobia.1');

        $run = $this->go('1.15.1-gobia.1');

        $this->assertFailedAt($run, 'check');
        $this->assertStringContainsString('not newer', $run['error']);
        $this->assertSame([], $this->runner->calls);
    }

    public function testVersionTheSourceDoesNotPublishIsRefused(): void
    {
        $run = $this->go('1.15.1-gobia.5');

        $this->assertFailedAt($run, 'check');
        $this->assertStringContainsString('not published', $run['error']);
    }

    public function testErrorsNeverContainSecrets(): void
    {
        config(['gobia.update.github_token' => sprintf('gh%s_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE', 'p')]);
        $this->publish();
        $this->provider->failWith = 'Request failed with Authorization: Bearer ' . sprintf('gh%s_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE', 'p');

        $run = $this->go();

        $this->assertStringNotContainsString('FAKEFAKEFAKEFAKE', json_encode($run));
        $this->assertStringNotContainsString('FAKEFAKEFAKEFAKE', $this->store->readLog($run['id']));
    }

    public function testASecondWorkerCannotRunWhileTheLockIsHeld(): void
    {
        $this->publish();
        $id = $this->queueRun();
        $handle = $this->store->tryLock();

        try {
            $this->expectException(UpdateException::class);
            $this->orchestrator()->execute($id);
        } finally {
            $this->store->unlock($handle);
        }
    }

    public function testOnlyOneRunCanBeActive(): void
    {
        $this->queueRun();

        [$created, $existing] = $this->store->begin(\Pterodactyl\Services\Updater\UpdateOrchestrator::newRun($this->store->newId(), '1.15.1-gobia.1', '1.15.1-gobia.3', null));

        $this->assertFalse($created);
        $this->assertSame('1.15.1-gobia.2', $existing['to_version']);
    }

    public function testDeadWorkerIsRecoveredAndMaintenanceModeLifted(): void
    {
        $this->publish();
        $id = $this->queueRun();
        $run = $this->store->load($id);
        $run['state'] = 'running';
        $run['stage'] = 'migrate';
        $run['heartbeat'] = time() - 3600;
        $run['backup'] = ['database' => $this->state . '/db.sql', 'directory' => $this->state . '/b'];
        $run['flags'] = ['maintenance' => true, 'files_changed' => true, 'migrated' => true];
        $this->store->save($run);

        $this->assertTrue($this->store->isStale($this->store->load($id)));
        $recovered = $this->orchestrator()->recover($this->store->load($id));

        $this->assertSame('rolled_back', $recovered['result']);
        $this->assertSame(['restoreFiles', 'artisan:optimize:clear', 'artisan:up'], $this->runner->calls);
        $this->assertSame(['restore'], $this->backup->calls);
        $this->assertNull($this->store->active());
    }

    public function testRunWithRecentHeartbeatIsNotStale(): void
    {
        $id = $this->queueRun();

        $this->assertFalse($this->store->isStale($this->store->load($id)));
    }
}
