<?php

declare(strict_types=1);

namespace GobiaCore\Services;

use Closure;
use GuzzleHttp\Client;
use GuzzleHttp\Promise\PromiseInterface;
use GuzzleHttp\Utils;
use Illuminate\Support\Facades\Cache;
use Pterodactyl\Models\Allocation;
use Pterodactyl\Models\Node;
use Throwable;

/**
 * Aggregates capacity, allocation and live usage for the admin overview.
 *
 * Capacity and allocation always come from the database. Live usage comes from each Wings node
 * (`/api/system` and `/api/servers`), queried concurrently with short timeouts and cached briefly,
 * so one unreachable node never slows down or breaks the dashboard; it is just reported as offline.
 */
class NodeStatsService
{
    public const CACHE_KEY = 'gobia:admin:node-stats';

    /**
     * How long a live snapshot is reused, so opening the dashboard repeatedly never hammers Wings.
     */
    public const TTL = 45;

    public function __construct(private ?Closure $clientFactory = null) {}

    /**
     * @return array<string, mixed>
     */
    public function snapshot(bool $refresh = false): array
    {
        if ($refresh) {
            Cache::forget(self::CACHE_KEY);
        }

        return Cache::remember(self::CACHE_KEY, self::TTL, fn () => $this->build());
    }

    /**
     * @return array<string, mixed>
     */
    public function build(): array
    {
        $nodes = Node::query()
            ->with('location:id,short')
            ->withCount('servers')
            ->withSum('servers as allocated_memory', 'memory')
            ->withSum('servers as allocated_disk', 'disk')
            ->orderBy('name')
            ->get();

        $allocationCounts = Allocation::query()
            ->selectRaw('node_id, COUNT(*) as total, SUM(CASE WHEN server_id IS NOT NULL THEN 1 ELSE 0 END) as used')
            ->groupBy('node_id')
            ->get()
            ->keyBy('node_id');

        $live = $this->probe($nodes);

        $rows = $nodes->map(function (Node $node) use ($live, $allocationCounts) {
            $probe = $live[$node->id] ?? ['status' => 'offline'];
            $allocations = $allocationCounts->get($node->id);
            $cores = $probe['cpus'] ?? null;

            return [
                'id' => $node->id,
                'name' => $node->name,
                'fqdn' => $node->fqdn,
                'location' => $node->location->short ?? null,
                'status' => $node->maintenance_mode && ($probe['status'] === 'online') ? 'maintenance' : $probe['status'],
                'version' => $probe['version'] ?? null,
                'instances' => (int) $node->servers_count,
                'instances_running' => $probe['running'] ?? null,
                'ram' => [
                    'total' => (int) $node->memory * 1024 * 1024,
                    'allocated' => (int) $node->getAttribute('allocated_memory') * 1024 * 1024,
                    'used' => $probe['memory_bytes'] ?? null,
                ],
                'storage' => [
                    'total' => (int) $node->disk * 1024 * 1024,
                    'allocated' => (int) $node->getAttribute('allocated_disk') * 1024 * 1024,
                    'used' => $probe['disk_bytes'] ?? null,
                ],
                // 100 % means every core is fully busy. Null when the node did not report both numbers.
                'cpu' => [
                    'percent' => isset($probe['cpu_absolute'], $cores) && $cores > 0 ? round($probe['cpu_absolute'] / $cores, 1) : null,
                    'cores' => $cores,
                ],
                'allocations' => ['used' => (int) ($allocations->used ?? 0), 'total' => (int) ($allocations->total ?? 0)],
            ];
        })->values()->all();

        return ['generated_at' => gmdate('c'), 'global' => $this->aggregate($rows), 'nodes' => $rows];
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, mixed>
     */
    private function aggregate(array $rows): array
    {
        $sum = fn (string $group, string $key) => array_sum(array_map(fn ($row) => (int) $row[$group][$key], $rows));
        $reporting = array_values(array_filter($rows, fn ($row) => in_array($row['status'], ['online', 'maintenance'], true)));

        $cpuNodes = array_values(array_filter($reporting, fn ($row) => $row['cpu']['percent'] !== null));
        $cores = array_sum(array_map(fn ($row) => $row['cpu']['cores'], $cpuNodes));
        $busy = array_sum(array_map(fn ($row) => $row['cpu']['percent'] * $row['cpu']['cores'], $cpuNodes));

        return [
            'ram' => [
                'total' => $sum('ram', 'total'),
                'allocated' => $sum('ram', 'allocated'),
                'used' => $reporting === [] ? null : array_sum(array_map(fn ($row) => (int) $row['ram']['used'], $reporting)),
            ],
            'storage' => [
                'total' => $sum('storage', 'total'),
                'allocated' => $sum('storage', 'allocated'),
                'used' => $reporting === [] ? null : array_sum(array_map(fn ($row) => (int) $row['storage']['used'], $reporting)),
            ],
            // Core-weighted: a busy 2 core node does not outweigh an idle 32 core one.
            'cpu' => ['percent' => $cores > 0 ? round($busy / $cores, 1) : null, 'nodes_reporting' => count($cpuNodes)],
            'instances' => [
                'total' => array_sum(array_column($rows, 'instances')),
                'running' => $reporting === [] ? null : array_sum(array_map(fn ($row) => (int) $row['instances_running'], $reporting)),
            ],
            'nodes' => [
                'total' => count($rows),
                'online' => count(array_filter($rows, fn ($row) => $row['status'] === 'online')),
                'maintenance' => count(array_filter($rows, fn ($row) => $row['status'] === 'maintenance')),
                'offline' => count(array_filter($rows, fn ($row) => $row['status'] === 'offline')),
            ],
        ];
    }

    /**
     * Queries every node at once. A failure of any kind yields "offline" for that node only.
     *
     * @param  \Illuminate\Support\Collection<int, Node>  $nodes
     * @return array<int, array<string, mixed>>
     */
    private function probe($nodes): array
    {
        $requests = [];
        foreach ($nodes as $node) {
            $client = $this->client($node);
            $requests[$node->id] = [
                'system' => $client->getAsync('/api/system?v=2'),
                'servers' => $client->getAsync('/api/servers'),
            ];
        }

        $results = [];
        foreach ($requests as $id => $promises) {
            $settled = [];
            foreach ($promises as $name => $promise) {
                $settled[$name] = $this->settle($promise);
            }

            if ($settled['system'] === null && $settled['servers'] === null) {
                $results[$id] = ['status' => 'offline'];

                continue;
            }

            $memory = $disk = 0;
            $cpu = 0.0;
            $running = 0;
            foreach ($settled['servers'] ?? [] as $server) {
                $usage = $server['utilization'] ?? [];
                $memory += (int) ($usage['memory_bytes'] ?? 0);
                $disk += (int) ($usage['disk_bytes'] ?? 0);
                $cpu += (float) ($usage['cpu_absolute'] ?? 0);
                $running += ($server['state'] ?? ($usage['state'] ?? null)) === 'running' ? 1 : 0;
            }

            $results[$id] = [
                'status' => 'online',
                'version' => $settled['system']['version'] ?? null,
                'cpus' => isset($settled['system']['cpu_count']) ? (int) $settled['system']['cpu_count'] : null,
                'memory_bytes' => $settled['servers'] === null ? null : $memory,
                'disk_bytes' => $settled['servers'] === null ? null : $disk,
                'cpu_absolute' => $settled['servers'] === null ? null : $cpu,
                'running' => $settled['servers'] === null ? null : $running,
            ];
        }

        return $results;
    }

    private function settle(PromiseInterface $promise): ?array
    {
        try {
            $data = Utils::jsonDecode((string) $promise->wait()->getBody(), true);

            return is_array($data) ? $data : null;
        } catch (Throwable $exception) {
            return null;
        }
    }

    private function client(Node $node): Client
    {
        if ($this->clientFactory !== null) {
            return ($this->clientFactory)($node);
        }

        return new Client([
            'verify' => app()->environment('production'),
            'base_uri' => $node->getConnectionAddress(),
            'timeout' => 4,
            'connect_timeout' => 2,
            'http_errors' => true,
            'headers' => ['Authorization' => 'Bearer '.$node->getDecryptedKey(), 'Accept' => 'application/json'],
        ]);
    }
}
