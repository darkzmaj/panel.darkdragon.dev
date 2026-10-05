<?php

namespace Pterodactyl\Transformers\Api\Client;

use Pterodactyl\Models\Server;
use Pterodactyl\Models\Allocation;
use League\Fractal\Resource\Collection;

/**
 * The smallest description of a server that the dashboard list needs: identity, node, limits, status and the primary
 * connection. It leaves out the startup command, variables, egg and feature limits, each of which costs extra queries
 * per server, and it only ever returns the primary allocation (without notes), which every user with access may see.
 * The full transformer stays in use for every other endpoint.
 */
class ServerListTransformer extends BaseClientTransformer
{
    protected array $defaultIncludes = ['allocations'];

    public function getResourceName(): string
    {
        return Server::RESOURCE_NAME;
    }

    public function transform(Server $server): array
    {
        return [
            'server_owner' => $this->request->user()->id === $server->owner_id,
            'identifier' => config('pterodactyl.features.new_server_identifiers') ? $server->identifier : $server->uuidShort,
            '__deprecated_uuid_short' => $server->uuidShort,
            'server_identifier' => $server->identifier,
            'internal_id' => $server->id,
            'uuid' => $server->uuid,
            'name' => $server->name,
            'node' => $server->node->name,
            'is_node_under_maintenance' => $server->node->isUnderMaintenance(),
            'sftp_details' => ['ip' => $server->node->fqdn, 'port' => $server->node->daemonSFTP],
            'description' => $server->description,
            'limits' => [
                'memory' => $server->memory,
                'swap' => $server->swap,
                'disk' => $server->disk,
                'io' => $server->io,
                'cpu' => $server->cpu,
                'threads' => $server->threads,
                'oom_disabled' => $server->oom_disabled,
            ],
            'status' => $server->status,
            'is_suspended' => $server->isSuspended(),
            'is_installing' => !$server->isInstalled(),
            'is_transferring' => !is_null($server->transfer),
        ];
    }

    public function includeAllocations(Server $server): Collection
    {
        $primary = clone $server->allocation;
        $primary->notes = null;
        $primary->setRelation('server', $server);

        return $this->collection([$primary], $this->makeTransformer(AllocationTransformer::class), Allocation::RESOURCE_NAME);
    }
}
