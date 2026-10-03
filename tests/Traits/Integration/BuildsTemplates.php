<?php

namespace Pterodactyl\Tests\Traits\Integration;

use Pterodactyl\Models\Egg;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\Location;
use Pterodactyl\Models\Allocation;
use Pterodactyl\Models\ServerTemplate;
use Pterodactyl\Services\Admin\NodeStatsService;
use Pterodactyl\Services\Templates\TemplateService;

/**
 * Helpers for tests that need templates, nodes with free allocations and controllable node health.
 */
trait BuildsTemplates
{
    /** @var array<int, string> */
    protected array $nodeStatus = [];

    protected function bungeecord(): Egg
    {
        return Egg::query()->where('author', 'support@pterodactyl.io')->where('name', 'Bungeecord')->firstOrFail();
    }

    /**
     * Creates a node with the given number of free allocations on consecutive ports and registers its health.
     */
    protected function makeNode(array $attributes = [], int $allocations = 4, int $firstPort = 25565, string $status = 'online'): Node
    {
        $this->isolateExistingNodes();
        $attributes += ['location_id' => Location::factory()->create()->id];
        /** @var Node $node */
        $node = Node::factory()->create($attributes);
        for ($i = 0; $i < $allocations; ++$i) {
            Allocation::factory()->create(['node_id' => $node->id, 'ip' => long2ip(0x0A000000 + $node->id), 'port' => $firstPort + $i]);
        }
        $this->nodeStatus[$node->id] = $status;
        $this->applyNodeStatus();

        return $node;
    }

    private bool $nodesIsolated = false;

    /**
     * Other test classes leave public nodes behind. They would take part in "any compatible node" placement, so the
     * first time a test creates a node the existing ones are made non-public (inside the test's transaction, so this
     * is rolled back; tests that cannot use a transaction clean up after themselves).
     */
    private function isolateExistingNodes(): void
    {
        if (!$this->nodesIsolated && \Illuminate\Support\Facades\DB::transactionLevel() > 0) {
            $this->nodesIsolated = true;
            Node::query()->where('public', true)->update(['public' => false]);
        }
    }

    protected function setNodeStatus(Node $node, string $status): void
    {
        $this->nodeStatus[$node->id] = $status;
        $this->applyNodeStatus();
    }

    protected function applyNodeStatus(): void
    {
        $rows = collect($this->nodeStatus)->map(fn ($status, $id) => ['id' => $id, 'status' => $status])->values()->all();
        $stats = \Mockery::mock(NodeStatsService::class);
        $stats->shouldReceive('snapshot')->andReturn(['nodes' => $rows]);
        $this->swap(NodeStatsService::class, $stats);
    }

    /**
     * Valid template form input. Override any part of it.
     *
     * @return array<string, mixed>
     */
    protected function templateInput(array $override = []): array
    {
        $egg = $this->bungeecord();

        return array_replace([
            'name' => 'Lobby',
            'description' => 'A lobby server.',
            'nest_id' => $egg->nest_id,
            'egg_id' => $egg->id,
            'docker_image' => array_values($egg->docker_images)[0],
            'startup' => null,
            'memory' => 256,
            'swap' => 0,
            'disk' => 512,
            'cpu' => 0,
            'io' => 500,
            'oom_disabled' => true,
            'database_limit' => 0,
            'allocation_limit' => 0,
            'backup_limit' => 0,
            'placement_mode' => ServerTemplate::PLACEMENT_ANY,
            'additional_allocations' => 0,
            'start_automatically' => true,
            'temporary' => false,
            'allow_instance_delete' => true,
            'enabled' => true,
            'variables' => [
                'BUNGEE_VERSION' => ['value' => 'latest', 'overridable' => false],
                'SERVER_JARFILE' => ['value' => 'bungeecord.jar', 'overridable' => true],
            ],
        ], $override);
    }

    protected function makeTemplate(array $override = []): ServerTemplate
    {
        return app(TemplateService::class)->create($this->templateInput($override));
    }

    protected function removeTemplateStorage(): void
    {
        $root = storage_path('app/private/templates');
        if (!is_dir($root)) {
            return;
        }
        foreach (glob($root . '/*/blobs/*') ?: [] as $file) {
            @unlink($file);
        }
        foreach (glob($root . '/*/blobs') ?: [] as $dir) {
            @rmdir($dir);
        }
        foreach (glob($root . '/*') ?: [] as $dir) {
            @rmdir($dir);
        }
    }
}
