<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Integration\Gobia;

use GobiaCore\Services\NodeStatsService;
use GobiaTemplates\Models\ServerTemplate;
use GobiaTemplates\Services\TemplateService;
use Mockery;
use Pterodactyl\Models\Allocation;
use Pterodactyl\Models\Egg;
use Pterodactyl\Models\Location;
use Pterodactyl\Models\Node;

/** Helpers for tests that need templates, nodes with free allocations and controllable node health. */
trait BuildsTemplates
{
    use InstallsGobiaExtensions;

    /** @var array<int, string> */
    protected array $nodeStatus = [];

    protected ?string $templateStorage = null;

    private bool $nodesIsolated = false;

    protected function bootTemplates(): void
    {
        $this->installGobia(['gobia-core', 'gobia-templates']);
        $this->useTemplateStorage();
    }

    protected function shutdownTemplates(): void
    {
        $this->removeTemplateStorage();
        $this->uninstallGobia();
    }

    /** The seeded Bungeecord egg, as the core test helpers use. */
    protected function bungeecord(): Egg
    {
        return Egg::query()->where('author', 'support@pterodactyl.io')->where('name', 'Bungeecord')->firstOrFail();
    }

    /** Creates a node with the given number of free allocations on consecutive ports and registers its health. */
    protected function makeNode(array $attributes = [], int $allocations = 4, int $firstPort = 25565, string $status = 'online'): Node
    {
        $this->isolateExistingNodes();
        $attributes += ['location_id' => Location::factory()->create()->id];
        /** @var Node $node */
        $node = Node::factory()->create($attributes);
        for ($i = 0; $i < $allocations; $i++) {
            Allocation::factory()->create(['node_id' => $node->id, 'ip' => long2ip(0x0A000000 + $node->id), 'port' => $firstPort + $i]);
        }
        $this->nodeStatus[$node->id] = $status;
        $this->applyNodeStatus();

        return $node;
    }

    protected function setNodeStatus(Node $node, string $status): void
    {
        $this->nodeStatus[$node->id] = $status;
        $this->applyNodeStatus();
    }

    protected function applyNodeStatus(): void
    {
        $rows = collect($this->nodeStatus)->map(fn ($status, $id): array => ['id' => $id, 'status' => $status])->values()->all();
        $stats = Mockery::mock(NodeStatsService::class);
        $stats->shouldReceive('snapshot')->andReturn(['nodes' => $rows]);
        $this->swap(NodeStatsService::class, $stats);
    }

    /** @return array<string, mixed> */
    protected function templateInput(array $override = []): array
    {
        $egg = $this->bungeecord();

        return array_replace([
            'name' => 'Lobby',
            'description' => 'A lobby server.',
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

    protected function useTemplateStorage(): void
    {
        $this->templateStorage = sys_get_temp_dir().DIRECTORY_SEPARATOR.'gobia-tpl-'.bin2hex(random_bytes(6));
        config(['gobia_templates.storage' => $this->templateStorage]);
    }

    protected function removeTemplateStorage(): void
    {
        $directory = $this->templateStorage;
        $this->templateStorage = null;
        if (! $directory || ! str_starts_with($directory, sys_get_temp_dir()) || ! is_dir($directory)) {
            return;
        }

        $remove = function (string $path) use (&$remove): void {
            if (is_link($path) || is_file($path)) {
                @unlink($path);

                return;
            }
            foreach (scandir($path) ?: [] as $name) {
                if ($name !== '.' && $name !== '..') {
                    $remove($path.DIRECTORY_SEPARATOR.$name);
                }
            }
            @rmdir($path);
        };
        $remove($directory);
    }

    /** Nothing to remove: tests use the seeded egg and the templates tables are dropped with the extensions. */
    protected function removeTemplateFixtures(): void {}

    /** Other tests leave public nodes behind; they would take part in "any compatible node" placement. */
    private function isolateExistingNodes(): void
    {
        if (! $this->nodesIsolated) {
            $this->nodesIsolated = true;
            Node::query()->where('public', true)->update(['public' => false]);
        }
    }
}
