<?php

namespace Pterodactyl\Tests\Integration\Http\Controllers\Admin;

use Pterodactyl\Models\User;
use Pterodactyl\Services\Updater\RunStore;
use PHPUnit\Framework\Attributes\DataProvider;
use Pterodactyl\Services\Updater\UpdateService;
use Pterodactyl\Services\Updater\ReleaseVerifier;
use Pterodactyl\Tests\Integration\Http\HttpTestCase;
use Pterodactyl\Services\Updater\Providers\ReleaseProvider;
use Pterodactyl\Tests\Unit\Services\Updater\Support\UpdaterHelpers;

class UpdateControllerTest extends HttpTestCase
{
    use UpdaterHelpers;

    /** @var string[] */
    private array $spawned = [];

    public function setUp(): void
    {
        parent::setUp();
        $this->setUpUpdater();
        defined('LARAVEL_START') || define('LARAVEL_START', microtime(true));

        $this->app->instance(RunStore::class, $this->store);
        $this->app->instance(ReleaseProvider::class, $this->provider);
        $this->app->instance(ReleaseVerifier::class, new ReleaseVerifier($this->publicKey));

        $test = $this;
        $this->app->singleton(UpdateService::class, fn ($app) => new class ($app->make(ReleaseProvider::class), $app->make(ReleaseVerifier::class), $app->make(RunStore::class), $test) extends UpdateService {
            public function __construct($provider, $verifier, $store, private $test)
            {
                parent::__construct($provider, $verifier, $store);
            }

            protected function spawnWorker(string $runId): void
            {
                $this->test->recordSpawn($runId);
            }

            protected function spawnRecovery(): void
            {
                $this->test->recordSpawn('recovery');
            }
        });
    }

    public function tearDown(): void
    {
        $this->tearDownUpdater();
        parent::tearDown();
    }

    public function recordSpawn(string $what): void
    {
        $this->spawned[] = $what;
    }

    private function admin(): User
    {
        return User::factory()->admin()->create();
    }

    public function testGuestsCannotReachAnyUpdaterEndpoint(): void
    {
        foreach (['get' => ['/admin/system/updates', '/admin/system/updates/status', '/admin/system/updates/runs/20260101T000000-abcdef'], 'post' => ['/admin/system/updates/check', '/admin/system/updates/start']] as $method => $urls) {
            foreach ($urls as $url) {
                $status = $this->{$method}($url, $method === 'post' ? ['version' => '1.15.1-gobia.2'] : [])->getStatusCode();
                $this->assertContains($status, [302, 401, 403], "$method $url answered $status to a guest");
            }
        }
        $this->assertSame([], $this->spawned);
    }

    public function testRegularUsersAreRefusedByTheServer(): void
    {
        $this->publish();
        $user = User::factory()->create();

        $this->actingAs($user)->get('/admin/system/updates')->assertForbidden();
        $this->actingAs($user)->getJson('/admin/system/updates/status')->assertForbidden();
        $this->actingAs($user)->getJson('/admin/system/updates/runs/20260101T000000-abcdef')->assertForbidden();
        $this->actingAs($user)->postJson('/admin/system/updates/check')->assertForbidden();
        $this->actingAs($user)->postJson('/admin/system/updates/start', ['version' => '1.15.1-gobia.2'])->assertForbidden();

        $this->assertSame([], $this->spawned, 'no worker may be started on behalf of a regular user');
        $this->assertNull($this->store->active());
    }

    public function testAdminsSeeTheUpdatePageAndStatus(): void
    {
        $this->publish();
        $admin = $this->admin();

        $this->actingAs($admin)->get('/admin/system/updates')->assertOk()->assertSee('Panel Updates')->assertSee('1.15.1-gobia.1');
        $this->actingAs($admin)->getJson('/admin/system/updates/status')->assertOk()->assertJsonPath('current', '1.15.1-gobia.1')->assertJsonPath('active', null);
    }

    public function testCheckReportsAvailableUpdate(): void
    {
        $this->publish();

        $this->actingAs($this->admin())->postJson('/admin/system/updates/check')
            ->assertOk()
            ->assertJsonPath('available', true)
            ->assertJsonPath('release.version', '1.15.1-gobia.2')
            ->assertJsonPath('release.migrations', true)
            ->assertJsonMissingPath('release.sha256');
    }

    public function testUpdateChecksAreRateLimited(): void
    {
        $admin = $this->admin();

        foreach (range(1, 6) as $ignored) {
            $this->actingAs($admin)->postJson('/admin/system/updates/check')->assertOk();
        }

        $this->actingAs($admin)->postJson('/admin/system/updates/check')->assertStatus(429);
    }

    public function testAdminCanStartAnUpdate(): void
    {
        $this->publish();

        $response = $this->actingAs($this->admin())->postJson('/admin/system/updates/start', ['version' => '1.15.1-gobia.2']);

        $response->assertStatus(202)->assertJsonPath('started', true)->assertJsonPath('run.to_version', '1.15.1-gobia.2');
        $this->assertSame([$response->json('run.id')], $this->spawned);
    }

    public function testSecondStartReportsTheRunningUpdate(): void
    {
        $this->publish();
        $admin = $this->admin();

        $first = $this->actingAs($admin)->postJson('/admin/system/updates/start', ['version' => '1.15.1-gobia.2']);
        $second = $this->actingAs($admin)->postJson('/admin/system/updates/start', ['version' => '1.15.1-gobia.2']);

        $second->assertOk()->assertJsonPath('started', false)->assertJsonPath('run.id', $first->json('run.id'));
        $this->assertCount(1, $this->spawned);
    }

    #[DataProvider('invalidVersions')]
    public function testInvalidAndTraversalVersionsAreRejectedByValidation(mixed $version): void
    {
        $this->actingAs($this->admin())->postJson('/admin/system/updates/start', ['version' => $version])->assertStatus(422);

        $this->assertSame([], $this->spawned);
        $this->assertNull($this->store->active());
    }

    public static function invalidVersions(): array
    {
        return [
            ['../../etc/passwd'],
            ['1.15.1-gobia.2/../..'],
            ['1.15.1'],
            ['latest'],
            [''],
            ['1.15.1-gobia.2;id'],
            ["1.15.1-gobia.2\n"],
            [['1.15.1-gobia.2']],
            [null],
        ];
    }

    public function testUpdateToTheCurrentVersionIsRefused(): void
    {
        $this->publish('1.15.1-gobia.1');

        $this->actingAs($this->admin())->postJson('/admin/system/updates/start', ['version' => '1.15.1-gobia.1'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'The Panel is already up to date (1.15.1-gobia.1).');
    }

    public function testBrowserSuppliedUrlsAndSourcesAreIgnored(): void
    {
        $this->publish();

        $this->actingAs($this->admin())->postJson('/admin/system/updates/start', [
            'version' => '1.15.1-gobia.2',
            'url' => 'https://evil.example/panel.tar.gz',
            'repository' => 'evil/repo',
            'provider' => 'directory',
            'command' => 'rm -rf /',
        ])->assertStatus(202);

        $run = $this->store->active();
        $this->assertSame(['id', 'username'], array_keys($run['initiated_by']));
        $this->assertStringNotContainsString('evil', json_encode($run));
    }

    public function testRunDetailsAreOnlyForAdminsAndValidateTheId(): void
    {
        $this->publish();
        $admin = $this->admin();
        $id = $this->actingAs($admin)->postJson('/admin/system/updates/start', ['version' => '1.15.1-gobia.2'])->json('run.id');
        $this->store->log($id, 'Authorization: Bearer ' . sprintf('gh%s_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE', 'p') . ' leaked?');

        $this->actingAs($admin)->getJson('/admin/system/updates/runs/' . $id)
            ->assertOk()->assertJsonPath('run.id', $id)->assertJsonMissingPath('run.pid_secret');
        $this->assertStringNotContainsString('FAKEFAKEFAKEFAKE', $this->actingAs($admin)->getJson('/admin/system/updates/runs/' . $id)->getContent());

        $this->actingAs($admin)->getJson('/admin/system/updates/runs/..%2F..%2Fenv')->assertNotFound();
        $this->actingAs($admin)->getJson('/admin/system/updates/runs/20260101T000000-abcdef')->assertNotFound();
    }

    public function testPublicProgressEndpointIsAvailableToGuestsWithoutCookies(): void
    {
        $this->publish();
        $this->actingAs($this->admin())->postJson('/admin/system/updates/start', ['version' => '1.15.1-gobia.2']);
        $this->app['auth']->forgetGuards();

        $response = $this->getJson('/system/update-progress');

        $response->assertOk()->assertJsonPath('active', true)->assertJsonCount(12, 'steps');
        $this->assertSame([], $response->headers->getCookies());
        $this->assertStringNotContainsString('1.15.1', $response->getContent());
    }
}
