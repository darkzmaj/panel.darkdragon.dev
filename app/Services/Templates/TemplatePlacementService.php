<?php

namespace Pterodactyl\Services\Templates;

use Pterodactyl\Models\Node;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Allocation;
use Pterodactyl\Models\ServerTemplate;
use Pterodactyl\Models\TemplateInstance;
use Pterodactyl\Services\Admin\NodeStatsService;
use Pterodactyl\Exceptions\Service\Template\PlacementException;

/**
 * Chooses the node and allocations for a new instance. See docs/server-templates.md for the full description.
 *
 * Hard requirements remove a node from consideration. Every remaining node gets a score and the best one wins;
 * ties are broken by the lowest node id, so the same inputs always give the same answer.
 *
 *   score = 0.5 * memory headroom + 0.3 * disk headroom + 0.2 * free allocation share, each measured after placing
 *
 * Headroom is the fraction of the node's (overallocation aware) capacity that stays free once this instance is placed.
 */
class TemplatePlacementService
{
    public const WEIGHT_MEMORY = 0.5;
    public const WEIGHT_DISK = 0.3;
    public const WEIGHT_ALLOCATIONS = 0.2;

    private const ACTIVE_STATES = [
        TemplateInstance::STATE_QUEUED,
        TemplateInstance::STATE_ALLOCATING,
        TemplateInstance::STATE_CREATING,
        TemplateInstance::STATE_INSTALLING,
        TemplateInstance::STATE_DEPLOYING_FILES,
        TemplateInstance::STATE_STARTING,
    ];

    public function __construct(private NodeStatsService $stats)
    {
    }

    /**
     * @param array<string, mixed> $snapshot a template revision snapshot
     *
     * @return array{node: Node, allocation_id: int, additional: int[], score: float}
     *
     * @throws PlacementException
     */
    public function place(int $templateId, array $snapshot, ?int $ignoreInstanceId = null): array
    {
        $settings = $snapshot['settings'];
        $this->assertInstanceLimit($templateId, $settings, $ignoreInstanceId);

        $candidates = $this->candidates($settings, $snapshot['allowed_nodes'] ?? []);
        if ($candidates->isEmpty()) {
            throw new PlacementException('No node matches the placement rules of this template.');
        }

        $status = collect($this->stats->snapshot()['nodes'] ?? [])->pluck('status', 'id');
        $usage = Server::query()
            ->selectRaw('node_id, SUM(memory) as memory, SUM(disk) as disk')
            ->whereIn('node_id', $candidates->pluck('id'))
            ->groupBy('node_id')
            ->get()->keyBy('node_id');
        $allocationTotals = Allocation::query()
            ->selectRaw('node_id, COUNT(*) as total, SUM(CASE WHEN server_id IS NULL THEN 1 ELSE 0 END) as free')
            ->whereIn('node_id', $candidates->pluck('id'))
            ->groupBy('node_id')
            ->get()->keyBy('node_id');

        $needed = 1 + (int) ($settings['additional_allocations'] ?? 0);
        $ports = PortSpec::parse($settings['preferred_ports'] ?? null) ?? [];
        $memory = (int) $settings['memory'];
        $disk = (int) $settings['disk'];

        $reasons = [];
        $viable = [];
        foreach ($candidates as $node) {
            if ($node->maintenance_mode) {
                $reasons[$node->name] = 'in maintenance mode';
                continue;
            }
            if (($status[$node->id] ?? 'offline') !== 'online') {
                $reasons[$node->name] = 'offline';
                continue;
            }

            // An overallocation of -1 means the administrator turned the limit check off for this node.
            $memoryCapacity = $node->memory * (1 + max(0, $node->memory_overallocate) / 100);
            $usedMemory = (int) ($usage->get($node->id)?->memory ?? 0);
            if ($memory > 0 && $node->memory_overallocate >= 0 && $usedMemory + $memory > $memoryCapacity) {
                $reasons[$node->name] = 'not enough memory';
                continue;
            }

            $diskCapacity = $node->disk * (1 + max(0, $node->disk_overallocate) / 100);
            $usedDisk = (int) ($usage->get($node->id)?->disk ?? 0);
            if ($disk > 0 && $node->disk_overallocate >= 0 && $usedDisk + $disk > $diskCapacity) {
                $reasons[$node->name] = 'not enough disk space';
                continue;
            }

            $free = (int) ($allocationTotals->get($node->id)?->getAttribute('free') ?? 0);
            if ($free < $needed) {
                $reasons[$node->name] = 'not enough free allocations';
                continue;
            }

            $total = max(1, (int) $allocationTotals->get($node->id)->getAttribute('total'));
            $viable[] = [
                'node' => $node,
                'score' => round(
                    self::WEIGHT_MEMORY * ($memoryCapacity > 0 ? max(0, $memoryCapacity - $usedMemory - $memory) / $memoryCapacity : 0)
                    + self::WEIGHT_DISK * ($diskCapacity > 0 ? max(0, $diskCapacity - $usedDisk - $disk) / $diskCapacity : 0)
                    + self::WEIGHT_ALLOCATIONS * (($free - $needed) / $total),
                    6
                ),
            ];
        }

        if ($viable === []) {
            $summary = collect($reasons)->map(fn ($reason, $name) => "$name: $reason")->implode('; ');

            throw new PlacementException('No node can host this template (' . $summary . ').', $reasons);
        }

        usort($viable, fn ($a, $b) => [$b['score'], $a['node']->id] <=> [$a['score'], $b['node']->id]);
        $best = $viable[0];

        $picked = $this->pickAllocations($best['node'], $needed, $ports);

        return [
            'node' => $best['node'],
            'allocation_id' => $picked[0],
            'additional' => array_slice($picked, 1),
            'score' => $best['score'],
        ];
    }

    /**
     * Free allocations on a node, preferred ports first (in the order they were listed), then by port.
     *
     * @param int[] $preferred
     *
     * @return int[]
     */
    public function pickAllocations(Node $node, int $needed, array $preferred): array
    {
        $free = Allocation::query()
            ->where('node_id', $node->id)
            ->whereNull('server_id')
            ->orderBy('port')->orderBy('id')
            ->get(['id', 'port']);

        $rank = array_flip($preferred);
        $sorted = $free->sortBy(fn ($allocation) => [isset($rank[$allocation->port]) ? 0 : 1, $rank[$allocation->port] ?? $allocation->port, $allocation->id])->values();

        return $sorted->take($needed)->pluck('id')->map(fn ($id) => (int) $id)->all();
    }

    /**
     * @param int[] $allowed
     *
     * @return \Illuminate\Support\Collection<int, Node>
     */
    private function candidates(array $settings, array $allowed)
    {
        $query = Node::query()->orderBy('id');

        switch ($settings['placement_mode']) {
            case ServerTemplate::PLACEMENT_FIXED:
                $query->where('id', $settings['node_id'] ?? 0);
                break;
            case ServerTemplate::PLACEMENT_ALLOWED:
                $query->whereIn('id', $allowed ?: [0]);
                break;
            default:
                // "Any compatible node" only considers nodes the admin has made available for automatic deployment.
                $query->where('public', true);
        }
        if (!empty($settings['location_id'])) {
            $query->where('location_id', $settings['location_id']);
        }

        return $query->get();
    }

    private function assertInstanceLimit(int $templateId, array $settings, ?int $ignoreInstanceId): void
    {
        if (empty($settings['max_instances'])) {
            return;
        }

        $count = TemplateInstance::query()
            ->where('template_id', $templateId)
            ->when($ignoreInstanceId, fn ($q) => $q->where('id', '!=', $ignoreInstanceId))
            ->where(function ($q) {
                $q->whereIn('state', self::ACTIVE_STATES)
                    ->orWhere(fn ($q) => $q->where('state', TemplateInstance::STATE_READY)->whereNotNull('server_id'));
            })->count();

        if ($count >= (int) $settings['max_instances']) {
            throw new PlacementException('This template has reached its limit of ' . $settings['max_instances'] . ' instances.');
        }
    }
}
