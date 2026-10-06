<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Integration\Gobia\Templates;

use GobiaTemplates\Models\TemplateInstance;
use GobiaTemplates\Services\TemplateInstanceService;
use GobiaTemplates\Services\TemplateProvisioningService;
use GobiaTemplates\Services\TemplateService;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Models\Allocation;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Gobia\BuildsTemplates;
use Pterodactyl\Tests\Integration\IntegrationTestCase;
use Ramsey\Uuid\Uuid;

/**
 * The provisioning pipeline against a faked Wings: every call the panel makes to the node is recorded and answered
 * from here, so nothing leaves the process and each stage can be asserted on.
 */
class TemplateProvisioningServiceTest extends IntegrationTestCase
{
    use BuildsTemplates;

    /** @var list<array{method: string, path: string, body: string}> */
    private array $calls = [];

    private bool $createFails = false;

    public function setUp(): void
    {
        parent::setUp();
        $this->bootTemplates();
        Queue::fake();
        $this->calls = [];
        $this->createFails = false;
        Http::fake(function (Request $request) {
            $path = parse_url($request->url(), PHP_URL_PATH).'';
            $this->calls[] = ['method' => $request->method(), 'path' => $path, 'body' => $request->body()];
            if ($request->method() === 'POST' && $path === '/api/servers' && $this->createFails) {
                return Http::response(['error' => 'down'], 500);
            }
            if ($request->method() === 'GET' && preg_match('#^/api/servers/[0-9a-f-]{36}$#', $path)) {
                return Http::response(['data' => ['state' => 'offline', 'is_suspended' => false]]);
            }

            return Http::response('', 204);
        });
    }

    public function tearDown(): void
    {
        $this->shutdownTemplates();
        parent::tearDown();
    }

    private function provisioning(): TemplateProvisioningService
    {
        return app(TemplateProvisioningService::class);
    }

    private function queue(\GobiaTemplates\Models\ServerTemplate $template, array $input = []): TemplateInstance
    {
        [$instance] = app(TemplateInstanceService::class)->request($template, $input + ['name' => 'Lobby 1', 'owner_id' => User::factory()->create()->id]);

        return $instance;
    }

    /** Runs the pipeline to the end, pretending Wings reports the installation as finished once the server exists. */
    private function drive(TemplateInstance $instance, bool $installSucceeds = true, ?array &$seen = null): TemplateInstance
    {
        $seen = [$instance->state];
        for ($i = 0; $i < 20; ++$i) {
            $instance->refresh();
            if ($instance->server_id && $instance->state === TemplateInstance::STATE_INSTALLING) {
                Server::query()->whereKey($instance->server_id)->update(['status' => $installSucceeds ? null : Server::STATUS_INSTALL_FAILED]);
            }
            $delay = $this->provisioning()->advance($instance);
            $seen[] = $instance->refresh()->state;
            if ($delay === null) {
                break;
            }
        }

        return $instance->refresh();
    }

    /** @return list<array{method: string, path: string, body: string}> */
    private function callsTo(string $method, string $pattern): array
    {
        return array_values(array_filter($this->calls, fn (array $call): bool => $call['method'] === $method && preg_match($pattern, $call['path']) === 1));
    }

    public function testAnInstanceIsProvisionedThroughEveryState(): void
    {
        $node = $this->makeNode();
        $service = app(TemplateService::class);
        $template = $this->makeTemplate(['placement_mode' => 'fixed_node', 'node_id' => $node->id, 'additional_allocations' => 1]);
        $service->putFile($template, 'plugins/config.yml', "motd: hi\n");
        $service->putFile($template, 'server.properties', "a=b\n");
        $service->publish($template);
        $template->refresh();

        $instance = $this->queue($template, ['environment' => ['SERVER_JARFILE' => 'custom.jar']]);
        $this->assertSame(TemplateInstance::STATE_QUEUED, $instance->state);
        $instance = $this->drive($instance, true, $seen);

        $this->assertSame(['queued', 'allocating', 'installing', 'deploying_files', 'starting', 'ready'], array_values(array_unique($seen)));
        $this->assertSame(TemplateInstance::STATE_READY, $instance->state);

        $server = Server::query()->findOrFail($instance->server_id);
        $this->assertSame($node->id, $server->node_id);
        $this->assertSame($template->id, $instance->template_id);
        $this->assertSame($template->revision, $instance->template_revision);
        $this->assertSame(256, $server->memory);
        $this->assertSame(512, $server->disk);
        $this->assertSame($instance->owner_id, $server->owner_id);
        $this->assertSame(2, Allocation::query()->where('server_id', $server->id)->count());
        $this->assertSame('custom.jar', $server->variables()->get()->firstWhere('env_variable', 'SERVER_JARFILE')->server_value);
        $this->assertSame('latest', $server->variables()->get()->firstWhere('env_variable', 'BUNGEE_VERSION')->server_value);

        // The node was asked to create the server without starting it, got the files, and was then told to start.
        $created = $this->callsTo('POST', '#^/api/servers$#');
        $this->assertCount(1, $created);
        $this->assertFalse(json_decode($created[0]['body'], true)['start_on_completion']);
        $this->assertCount(1, $this->callsTo('POST', '#/files/create-directory$#'));
        $writes = $this->callsTo('POST', '#/files/write$#');
        $this->assertCount(2, $writes);
        $this->assertEqualsCanonicalizing(["motd: hi\n", "a=b\n"], array_column($writes, 'body'));
        $power = $this->callsTo('POST', '#/power$#');
        $this->assertCount(1, $power);
        $this->assertSame('start', json_decode($power[0]['body'], true)['action']);

        // Stage timings are recorded for every stage the instance passed through.
        $this->assertArrayHasKey('installing', $instance->stage_ms ?? []);
    }

    public function testTheServerIsNotStartedWhenTheTemplateSaysNot(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate(['start_automatically' => false]);

        $this->assertSame(TemplateInstance::STATE_READY, $this->drive($this->queue($template))->state);
        $this->assertCount(0, $this->callsTo('POST', '#/power$#'));
    }

    public function testTemporaryTemplatesGetAnExpiry(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate(['start_automatically' => false, 'temporary' => true, 'ttl_minutes' => 30]);

        $instance = $this->drive($this->queue($template));
        $this->assertEqualsWithDelta(now()->addMinutes(30)->timestamp, $instance->expires_at->timestamp, 5);
    }

    public function testNotEnoughMemoryFailsEarlyWithAReadableReasonAndCreatesNothing(): void
    {
        $this->makeNode(['memory' => 1024]);
        $template = $this->makeTemplate(['memory' => 4096]);

        $instance = $this->drive($this->queue($template));

        $this->assertSame(TemplateInstance::STATE_FAILED, $instance->state);
        $this->assertSame('allocating', $instance->failed_stage);
        $this->assertStringContainsString('not enough memory', $instance->error);
        $this->assertNull($instance->server_id);
        $this->assertCount(0, $this->callsTo('POST', '#^/api/servers$#'));
    }

    public function testAFailedInstallationIsCleanedUpAndAllocationsAreFreed(): void
    {
        $node = $this->makeNode([], 2);
        $template = $this->makeTemplate();

        $instance = $this->drive($this->queue($template), false);

        $this->assertSame(TemplateInstance::STATE_FAILED, $instance->state);
        $this->assertSame('installing', $instance->failed_stage);
        $this->assertNull($instance->server_id);
        $this->assertSame(0, Allocation::query()->where('node_id', $node->id)->whereNotNull('server_id')->count());
        $this->assertCount(1, $this->callsTo('DELETE', '#^/api/servers/[0-9a-f-]{36}$#'));
    }

    public function testAnUnreachableNodeDuringCreationLeavesNoOrphans(): void
    {
        $node = $this->makeNode([], 2);
        $template = $this->makeTemplate();
        $this->createFails = true;

        $instance = $this->drive($this->queue($template));

        $this->assertSame(TemplateInstance::STATE_FAILED, $instance->state);
        $this->assertSame('creating', $instance->failed_stage);
        $this->assertSame('The node could not be reached or rejected the request.', $instance->error);
        $this->assertSame(0, Server::query()->where('node_id', $node->id)->count());
        $this->assertSame(0, Allocation::query()->where('node_id', $node->id)->whereNotNull('server_id')->count());
    }

    public function testErrorsNeverLeakInternalDetails(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate();
        Http::fake(fn () => throw new \RuntimeException('SQLSTATE secret connection string /var/www/.env'));

        $instance = $this->drive($this->queue($template));

        $this->assertSame(TemplateInstance::STATE_FAILED, $instance->state);
        $this->assertStringNotContainsString('SQLSTATE', $instance->error);
        $this->assertStringNotContainsString('.env', $instance->error);
    }

    public function testAFailedInstanceCanBeRetriedAndThenSucceeds(): void
    {
        $node = $this->makeNode(['memory' => 1024]);
        $template = $this->makeTemplate(['memory' => 2048]);
        $instance = $this->drive($this->queue($template));
        $this->assertSame(TemplateInstance::STATE_FAILED, $instance->state);

        $node->update(['memory' => 4096]);
        app(TemplateInstanceService::class)->retry($instance);
        $this->assertSame(1, $instance->refresh()->attempts);
        $this->assertSame(TemplateInstance::STATE_QUEUED, $instance->state);
        $this->assertNull($instance->error);

        $this->assertSame(TemplateInstance::STATE_READY, $this->drive($instance)->state);
    }

    public function testOnlyFailedInstancesCanBeRetried(): void
    {
        $this->makeNode();
        $instance = $this->queue($this->makeTemplate());

        $this->expectException(DisplayException::class);
        app(TemplateInstanceService::class)->retry($instance);
    }

    public function testInstancesAreBuiltFromTheRevisionTheyWereRequestedWith(): void
    {
        $this->makeNode(['memory' => 8192]);
        $service = app(TemplateService::class);
        $template = $this->makeTemplate(['start_automatically' => false]);
        $instance = $this->queue($template);

        $service->update($template, $this->templateInput(['memory' => 2048, 'start_automatically' => false]));
        $this->assertSame(2, $template->refresh()->revision);

        $instance = $this->drive($instance);

        $server = Server::query()->findOrFail($instance->server_id);
        $this->assertSame(256, $server->memory);
        $this->assertSame(1, $instance->template_revision);
    }

    public function testADisabledTemplateIsNotProvisioned(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate();
        $instance = $this->queue($template);
        app(TemplateService::class)->setEnabled($template, false);

        $instance = $this->drive($instance);
        $this->assertSame(TemplateInstance::STATE_FAILED, $instance->state);
        $this->assertStringContainsString('disabled', $instance->error);
        $this->assertCount(0, $this->callsTo('POST', '#^/api/servers$#'));
    }

    public function testTwoInstancesNeverReceiveTheSameAllocation(): void
    {
        $node = $this->makeNode([], 2);
        $template = $this->makeTemplate(['start_automatically' => false]);

        $one = $this->drive($this->queue($template, ['name' => 'One']));
        $two = $this->drive($this->queue($template, ['name' => 'Two']));

        $this->assertSame('ready', $one->state);
        $this->assertSame('ready', $two->state);
        $this->assertNotSame(Server::query()->find($one->server_id)->allocation_id, Server::query()->find($two->server_id)->allocation_id);

        $three = $this->drive($this->queue($template, ['name' => 'Three']));
        $this->assertSame('failed', $three->state);
        $this->assertStringContainsString('not enough free allocations', $three->error);
        $this->assertSame(2, Allocation::query()->where('node_id', $node->id)->whereNotNull('server_id')->count());
    }

    public function testExpiredTemporaryInstancesAreRemovedByTheMaintenanceCommand(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate(['temporary' => true, 'ttl_minutes' => 10, 'allow_instance_delete' => false]);
        $expired = $this->queue($template, ['name' => 'old']);
        $fresh = $this->queue($template, ['name' => 'fresh']);
        $oldServer = $this->createServerModel();
        $freshServer = $this->createServerModel();
        $expired->forceFill(['state' => 'ready', 'server_id' => $oldServer->id, 'expires_at' => now()->subMinute()])->save();
        $fresh->forceFill(['state' => 'ready', 'server_id' => $freshServer->id, 'expires_at' => now()->addHour()])->save();

        // Commands register when the app boots; this test installed the extension afterwards.
        \Illuminate\Support\Facades\Artisan::registerCommand(app(\GobiaTemplates\Console\ExpireTemplateInstancesCommand::class));
        $this->artisan('gobia-templates:expire-instances')->assertSuccessful();

        $this->assertDatabaseMissing('servers', ['id' => $oldServer->id]);
        $this->assertDatabaseHas('servers', ['id' => $freshServer->id]);
        $this->assertNull($expired->refresh()->server_id);
    }

    public function testInstanceUuidsAreUniqueAndNotGuessableIds(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate();
        $a = $this->queue($template, ['name' => 'a']);
        $b = $this->queue($template, ['name' => 'b']);

        $this->assertTrue(Uuid::isValid($a->uuid));
        $this->assertNotSame($a->uuid, $b->uuid);
    }
}
