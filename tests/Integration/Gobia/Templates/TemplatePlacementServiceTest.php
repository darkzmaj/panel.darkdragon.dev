<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Integration\Gobia\Templates;

use GobiaTemplates\Models\TemplateInstance;
use GobiaTemplates\Services\TemplatePlacementService;
use GobiaTemplates\Services\TemplateService;
use GobiaTemplates\Support\PlacementException;
use Pterodactyl\Models\Allocation;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\Server;
use Pterodactyl\Tests\Integration\Gobia\BuildsTemplates;
use Pterodactyl\Tests\Integration\IntegrationTestCase;

class TemplatePlacementServiceTest extends IntegrationTestCase
{
    use BuildsTemplates;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootTemplates();
    }

    protected function tearDown(): void
    {
        $this->shutdownTemplates();
        $this->removeTemplateFixtures();
        parent::tearDown();
    }

    public function test_the_node_with_the_most_free_capacity_wins(): void
    {
        $small = $this->makeNode(['memory' => 1024, 'disk' => 10240]);
        $large = $this->makeNode(['memory' => 8192, 'disk' => 102400]);

        $this->assertSame($large->id, $this->place()['node']->id);
        $this->assertGreaterThan(0, $this->place()['score']);
        $this->assertNotSame($small->id, $this->place()['node']->id);
    }

    public function test_used_capacity_lowers_the_score(): void
    {
        $busy = $this->makeNode(['memory' => 4096, 'disk' => 40960]);
        $idle = $this->makeNode(['memory' => 4096, 'disk' => 40960]);
        $this->createServerModel(['node_id' => $busy->id, 'memory' => 3000, 'disk' => 3000]);

        $this->assertSame($idle->id, $this->place()['node']->id);
    }

    public function test_ties_are_broken_by_the_lowest_node_id_so_the_result_is_deterministic(): void
    {
        $first = $this->makeNode();
        $second = $this->makeNode();

        for ($i = 0; $i < 3; $i++) {
            $this->assertSame($first->id, $this->place()['node']->id);
        }
        $this->assertLessThan($second->id, $first->id);
    }

    public function test_fixed_placement_only_uses_that_node_even_when_another_is_better(): void
    {
        $fixed = $this->makeNode(['memory' => 1024]);
        $this->makeNode(['memory' => 16384, 'disk' => 204800]);

        $this->assertSame($fixed->id, $this->place(['placement_mode' => 'fixed_node', 'node_id' => $fixed->id])['node']->id);
    }

    public function test_fixed_placement_fails_clearly_when_the_node_is_offline(): void
    {
        $fixed = $this->makeNode(['name' => 'Fixed One'], 4, 25565, 'offline');
        $this->makeNode();

        try {
            $this->place(['placement_mode' => 'fixed_node', 'node_id' => $fixed->id]);
            $this->fail('Expected a placement failure.');
        } catch (PlacementException $exception) {
            $this->assertStringContainsString('Fixed One: offline', $exception->getMessage());
        }
    }

    public function test_allowed_nodes_are_the_only_candidates(): void
    {
        $allowed = $this->makeNode(['memory' => 1024]);
        $this->makeNode(['memory' => 16384]);

        $placed = $this->place(['placement_mode' => 'allowed_nodes', 'allowed_nodes' => [$allowed->id]]);
        $this->assertSame($allowed->id, $placed['node']->id);
    }

    public function test_location_limits_the_candidates(): void
    {
        $inLocation = $this->makeNode(['memory' => 1024]);
        $this->makeNode(['memory' => 16384]);

        $placed = $this->place(['location_id' => $inLocation->location_id]);
        $this->assertSame($inLocation->id, $placed['node']->id);
    }

    public function test_nodes_that_are_offline_or_in_maintenance_are_never_used(): void
    {
        $offline = $this->makeNode(['memory' => 16384], 4, 25565, 'offline');
        $maintenance = $this->makeNode(['memory' => 16384, 'maintenance_mode' => true]);
        $ok = $this->makeNode(['memory' => 1024]);

        $this->assertSame($ok->id, $this->place()['node']->id);

        $this->setNodeStatus($ok, 'offline');
        try {
            $this->place();
            $this->fail('Expected a placement failure.');
        } catch (PlacementException $exception) {
            $this->assertSame('offline', $exception->getReasons()[$offline->name]);
            $this->assertSame('in maintenance mode', $exception->getReasons()[$maintenance->name]);
        }
    }

    public function test_non_public_nodes_are_skipped_for_any_node_placement_but_allowed_when_chosen_explicitly(): void
    {
        $private = $this->makeNode(['public' => false]);

        try {
            $this->place();
            $this->fail('Expected a placement failure.');
        } catch (PlacementException) {
            $this->assertSame($private->id, $this->place(['placement_mode' => 'fixed_node', 'node_id' => $private->id])['node']->id);
        }
    }

    public function test_insufficient_memory_is_reported_per_node(): void
    {
        $node = $this->makeNode(['memory' => 1024]);

        try {
            $this->place(['memory' => 2048]);
            $this->fail('Expected a placement failure.');
        } catch (PlacementException $exception) {
            $this->assertSame('not enough memory', $exception->getReasons()[$node->name]);
        }
    }

    public function test_insufficient_disk_is_reported_per_node(): void
    {
        $node = $this->makeNode(['disk' => 1024]);

        try {
            $this->place(['disk' => 4096]);
            $this->fail('Expected a placement failure.');
        } catch (PlacementException $exception) {
            $this->assertSame('not enough disk space', $exception->getReasons()[$node->name]);
        }
    }

    public function test_existing_servers_count_against_capacity(): void
    {
        $node = $this->makeNode(['memory' => 1024]);
        $this->createServerModel(['node_id' => $node->id, 'memory' => 900]);

        $this->expectException(PlacementException::class);
        $this->place(['memory' => 256]);
    }

    public function test_overallocation_extends_capacity_and_minus_one_disables_the_check(): void
    {
        $this->makeNode(['memory' => 1024, 'memory_overallocate' => 100]);
        $this->assertNotNull($this->place(['memory' => 1500]));

        $this->makeNode(['memory' => 128, 'memory_overallocate' => -1]);
        $this->assertNotNull($this->place(['memory' => 100000, 'placement_mode' => 'any']));
    }

    public function test_no_free_allocations_means_no_placement(): void
    {
        $node = $this->makeNode([], 0);

        try {
            $this->place();
            $this->fail('Expected a placement failure.');
        } catch (PlacementException $exception) {
            $this->assertSame('not enough free allocations', $exception->getReasons()[$node->name]);
        }
    }

    public function test_additional_allocations_must_all_be_available(): void
    {
        $this->makeNode([], 2);

        $this->assertCount(1, $this->place(['additional_allocations' => 1])['additional']);

        $this->expectException(PlacementException::class);
        $this->place(['additional_allocations' => 2]);
    }

    public function test_allocations_already_in_use_are_never_handed_out(): void
    {
        $node = $this->makeNode([], 2, 25565);
        $this->createServerModel(['node_id' => $node->id, 'allocation_id' => Allocation::query()->where('node_id', $node->id)->orderBy('port')->first()->id]);

        $placed = $this->place();
        $this->assertSame(25566, Allocation::query()->find($placed['allocation_id'])->port);
    }

    public function test_preferred_ports_are_used_first_then_the_lowest_free_port(): void
    {
        $this->makeNode([], 6, 25565);

        $placed = $this->place(['preferred_ports' => '25568,25567', 'additional_allocations' => 2]);
        $ports = Allocation::query()->whereIn('id', array_merge([$placed['allocation_id']], $placed['additional']))->get()->keyBy('id');

        $this->assertSame(25568, $ports[$placed['allocation_id']]->port);
        $this->assertSame([25567, 25565], collect($placed['additional'])->map(fn ($id) => $ports[$id]->port)->all());
    }

    public function test_the_instance_limit_is_enforced_for_active_and_ready_instances_only(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate(['max_instances' => 1]);
        $snapshot = app(TemplateService::class)->snapshot($template);
        $owner = \Pterodactyl\Models\User::factory()->create();

        $make = fn (string $state, ?int $serverId = null) => TemplateInstance::query()->create([
            'uuid' => (string) \Ramsey\Uuid\Uuid::uuid4(),
            'template_id' => $template->id,
            'template_revision' => 1,
            'owner_id' => $owner->id,
            'name' => 'x',
            'state' => $state,
            'server_id' => $serverId,
        ]);

        // A failed instance or a ready instance whose server is gone does not use up the limit.
        $make('failed');
        $make('ready');
        $this->assertNotNull($this->placement()->place($template->id, $snapshot));

        $queued = $make('queued');
        try {
            $this->placement()->place($template->id, $snapshot);
            $this->fail('Expected the instance limit to apply.');
        } catch (PlacementException $exception) {
            $this->assertStringContainsString('limit of 1', $exception->getMessage());
        }

        // The instance being placed never counts against itself.
        $this->assertNotNull($this->placement()->place($template->id, $snapshot, $queued->id));
    }

    // Resolved on every use: the node health fake is swapped into the container as nodes are created.
    private function placement(): TemplatePlacementService
    {
        return app(TemplatePlacementService::class);
    }

    private function place(array $templateOverride = [])
    {
        $template = $this->makeTemplate($templateOverride);

        return $this->placement()->place($template->id, app(TemplateService::class)->snapshot($template));
    }
}
