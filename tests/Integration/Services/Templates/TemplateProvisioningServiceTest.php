<?php

namespace Pterodactyl\Tests\Integration\Services\Templates;

use Ramsey\Uuid\Uuid;
use Mockery\MockInterface;
use Pterodactyl\Models\User;
use GuzzleHttp\Psr7\Response;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Allocation;
use Pterodactyl\Models\TemplateInstance;
use GuzzleHttp\Exception\TransferException;
use Pterodactyl\Services\Templates\TemplateService;
use Pterodactyl\Tests\Integration\IntegrationTestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Pterodactyl\Repositories\Wings\DaemonFileRepository;
use Pterodactyl\Repositories\Wings\DaemonPowerRepository;
use Pterodactyl\Tests\Traits\Integration\BuildsTemplates;
use Pterodactyl\Repositories\Wings\DaemonServerRepository;
use Pterodactyl\Services\Templates\TemplateInstanceService;
use Pterodactyl\Services\Templates\TemplateProvisioningService;
use Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException;

class TemplateProvisioningServiceTest extends IntegrationTestCase
{
    use BuildsTemplates;
    use DatabaseTransactions;

    private MockInterface $server;
    private MockInterface $files;
    private MockInterface $power;

    public function setUp(): void
    {
        parent::setUp();
        $this->useTemplateStorage();

        \Illuminate\Support\Facades\Queue::fake();

        $this->server = \Mockery::mock(DaemonServerRepository::class);
        $this->server->shouldReceive('setServer')->andReturnSelf();
        $this->files = \Mockery::mock(DaemonFileRepository::class);
        $this->files->shouldReceive('setServer')->andReturnSelf();
        $this->power = \Mockery::mock(DaemonPowerRepository::class);
        $this->power->shouldReceive('setServer')->andReturnSelf();

        $this->swap(DaemonServerRepository::class, $this->server);
        $this->swap(DaemonFileRepository::class, $this->files);
        $this->swap(DaemonPowerRepository::class, $this->power);
    }

    public function tearDown(): void
    {
        $this->removeTemplateStorage();
        parent::tearDown();
    }

    private function provisioning(): TemplateProvisioningService
    {
        return app(TemplateProvisioningService::class);
    }

    private function queue(\Pterodactyl\Models\ServerTemplate $template, array $input = []): TemplateInstance
    {
        [$instance] = app(TemplateInstanceService::class)->request($template, $input + [
            'name' => 'Lobby 1',
            'owner_id' => User::factory()->create()->id,
        ]);

        return $instance;
    }

    /**
     * Runs the pipeline to the end, pretending Wings reports the installation as finished once the server exists.
     */
    private function drive(TemplateInstance $instance, bool $installSucceeds = true): TemplateInstance
    {
        for ($i = 0; $i < 20; ++$i) {
            $instance->refresh();
            if ($instance->server_id && $instance->state === TemplateInstance::STATE_INSTALLING) {
                Server::query()->whereKey($instance->server_id)->update(['status' => $installSucceeds ? null : Server::STATUS_INSTALL_FAILED]);
            }
            if ($this->provisioning()->advance($instance) === null) {
                break;
            }
        }

        return $instance->refresh();
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

        $this->server->shouldReceive('create')->once()->with(false);
        $this->server->shouldReceive('getDetails')->once()->andReturn(['state' => 'offline']);
        $this->files->shouldReceive('createDirectory')->once()->with('plugins', '/')->andReturn(new Response());
        $this->files->shouldReceive('putContent')->once()->with('/plugins/config.yml', "motd: hi\n")->andReturn(new Response());
        $this->files->shouldReceive('putContent')->once()->with('/server.properties', "a=b\n")->andReturn(new Response());
        $this->power->shouldReceive('send')->once()->with('start')->andReturn(new Response());

        $instance = $this->queue($template, ['overrides' => 'ignored', 'environment' => ['SERVER_JARFILE' => 'custom.jar']]);
        $this->assertSame(TemplateInstance::STATE_QUEUED, $instance->state);

        $seen = [$instance->state];
        for ($i = 0; $i < 20; ++$i) {
            $instance->refresh();
            if ($instance->server_id && $instance->state === TemplateInstance::STATE_INSTALLING) {
                Server::query()->whereKey($instance->server_id)->update(['status' => null]);
            }
            $delay = $this->provisioning()->advance($instance);
            $seen[] = $instance->refresh()->state;
            if ($delay === null) {
                break;
            }
        }

        // "creating" is only held while the Wings create call runs inside the placement step.
        $this->assertSame(
            ['queued', 'allocating', 'installing', 'deploying_files', 'starting', 'ready'],
            array_values(array_unique($seen))
        );
        $this->assertSame(TemplateInstance::STATE_READY, $instance->state);

        $server = Server::query()->findOrFail($instance->server_id);
        $this->assertSame($node->id, $server->node_id);
        $this->assertSame($template->id, $server->template_id);
        $this->assertSame($template->revision, $server->template_revision);
        $this->assertSame(256, $server->memory);
        $this->assertSame(512, $server->disk);
        $this->assertSame($instance->owner_id, $server->owner_id);
        $this->assertSame(2, Allocation::query()->where('server_id', $server->id)->count());
        $this->assertSame('custom.jar', $server->variables()->get()->firstWhere('env_variable', 'SERVER_JARFILE')->server_value);
        $this->assertSame('latest', $server->variables()->get()->firstWhere('env_variable', 'BUNGEE_VERSION')->server_value);
    }

    public function testTheServerIsNotStartedWhenTheTemplateSaysNot(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate(['start_automatically' => false]);

        $this->server->shouldReceive('create')->once()->with(false);
        $this->server->shouldReceive('getDetails')->once()->andReturn([]);
        $this->power->shouldNotReceive('send');

        $this->assertSame(TemplateInstance::STATE_READY, $this->drive($this->queue($template))->state);
    }

    public function testTemporaryTemplatesGetAnExpiry(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate(['start_automatically' => false, 'temporary' => true, 'ttl_minutes' => 30]);
        $this->server->shouldReceive('create')->once();
        $this->server->shouldReceive('getDetails')->once()->andReturn([]);

        $instance = $this->drive($this->queue($template));
        $this->assertEqualsWithDelta(now()->addMinutes(30)->timestamp, $instance->expires_at->timestamp, 5);
    }

    public function testNotEnoughMemoryFailsEarlyWithAReadableReasonAndCreatesNothing(): void
    {
        $this->makeNode(['memory' => 1024]);
        $template = $this->makeTemplate(['memory' => 4096]);
        $this->server->shouldNotReceive('create');

        $instance = $this->drive($this->queue($template));

        $this->assertSame(TemplateInstance::STATE_FAILED, $instance->state);
        $this->assertSame('allocating', $instance->failed_stage);
        $this->assertStringContainsString('not enough memory', $instance->error);
        $this->assertNull($instance->server_id);
        $this->assertSame(0, Server::query()->where('template_id', $template->id)->count());
    }

    public function testAFailedInstallationIsCleanedUpAndAllocationsAreFreed(): void
    {
        $node = $this->makeNode([], 2);
        $template = $this->makeTemplate();
        $this->server->shouldReceive('create')->once();
        $this->server->shouldReceive('delete')->once();

        $instance = $this->drive($this->queue($template), false);

        $this->assertSame(TemplateInstance::STATE_FAILED, $instance->state);
        $this->assertSame('installing', $instance->failed_stage);
        $this->assertNull($instance->server_id);
        $this->assertSame(0, Server::query()->where('template_id', $template->id)->count());
        $this->assertSame(0, Allocation::query()->where('node_id', $node->id)->whereNotNull('server_id')->count());
    }

    public function testAnUnreachableNodeDuringCreationLeavesNoOrphans(): void
    {
        $node = $this->makeNode([], 2);
        $template = $this->makeTemplate();
        $this->server->shouldReceive('create')->once()->andThrow(new DaemonConnectionException(new TransferException('down')));
        $this->server->shouldReceive('delete')->once();

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
        $this->server->shouldReceive('create')->once()->andThrow(new \RuntimeException('SQLSTATE secret connection string /var/www/.env'));
        $this->server->shouldReceive('delete')->zeroOrMoreTimes();

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

        // More capacity becomes available, then the instance is retried.
        $node->update(['memory' => 4096]);
        $this->server->shouldReceive('create')->once();
        $this->server->shouldReceive('getDetails')->once()->andReturn([]);
        $this->power->shouldReceive('send')->once()->andReturn(new Response());

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

        $this->expectException(\Pterodactyl\Exceptions\DisplayException::class);
        app(TemplateInstanceService::class)->retry($instance);
    }

    public function testInstancesAreBuiltFromTheRevisionTheyWereRequestedWith(): void
    {
        $this->makeNode(['memory' => 8192]);
        $service = app(TemplateService::class);
        $template = $this->makeTemplate(['start_automatically' => false]);
        $instance = $this->queue($template);

        // The template is edited after the request was accepted but before it ran.
        $service->update($template, $this->templateInput(['memory' => 2048, 'start_automatically' => false]));
        $this->assertSame(2, $template->refresh()->revision);

        $this->server->shouldReceive('create')->once();
        $this->server->shouldReceive('getDetails')->once()->andReturn([]);
        $instance = $this->drive($instance);

        $server = Server::query()->findOrFail($instance->server_id);
        $this->assertSame(256, $server->memory);
        $this->assertSame(1, $server->template_revision);
    }

    public function testADisabledTemplateIsNotProvisioned(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate();
        $instance = $this->queue($template);
        app(TemplateService::class)->setEnabled($template, false);
        $this->server->shouldNotReceive('create');

        $instance = $this->drive($instance);
        $this->assertSame(TemplateInstance::STATE_FAILED, $instance->state);
        $this->assertStringContainsString('disabled', $instance->error);
    }

    public function testTwoInstancesNeverReceiveTheSameAllocation(): void
    {
        $node = $this->makeNode([], 2);
        $template = $this->makeTemplate(['start_automatically' => false]);
        $this->server->shouldReceive('create')->twice();
        $this->server->shouldReceive('getDetails')->twice()->andReturn([]);

        $one = $this->drive($this->queue($template, ['name' => 'One']));
        $two = $this->drive($this->queue($template, ['name' => 'Two']));

        $this->assertSame('ready', $one->state);
        $this->assertSame('ready', $two->state);
        $this->assertNotSame(Server::query()->find($one->server_id)->allocation_id, Server::query()->find($two->server_id)->allocation_id);

        // The node is now out of allocations.
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

        $this->server->shouldReceive('delete')->once();
        $this->artisan('p:maintenance:expire-template-instances')->assertSuccessful();

        // The template's own expiry applies even though the API may not delete these instances.
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
