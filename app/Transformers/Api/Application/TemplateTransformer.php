<?php

namespace Pterodactyl\Transformers\Api\Application;

use Pterodactyl\Models\ServerTemplate;

class TemplateTransformer extends BaseTransformer
{
    public function getResourceName(): string
    {
        return ServerTemplate::RESOURCE_NAME;
    }

    /**
     * Only a description of what an instance will look like. Template files and startup details are not exposed.
     */
    public function transform(ServerTemplate $template): array
    {
        return [
            'id' => $template->id,
            'uuid' => $template->uuid,
            'name' => $template->name,
            'slug' => $template->slug,
            'description' => $template->description,
            'enabled' => $template->enabled,
            'revision' => $template->revision,
            'egg' => $template->egg_id,
            'nest' => $template->nest_id,
            'limits' => [
                'memory' => $template->memory,
                'swap' => $template->swap,
                'disk' => $template->disk,
                'io' => $template->io,
                'cpu' => $template->cpu,
            ],
            'feature_limits' => [
                'databases' => $template->database_limit,
                'allocations' => $template->allocation_limit,
                'backups' => $template->backup_limit,
            ],
            'placement' => [
                'mode' => $template->placement_mode,
                'additional_allocations' => $template->additional_allocations,
            ],
            'lifecycle' => [
                'start_automatically' => $template->start_automatically,
                'temporary' => $template->temporary,
                'ttl_minutes' => $template->ttl_minutes,
            ],
            $template->getUpdatedAtColumn() => $this->formatTimestamp($template->updated_at),
            $template->getCreatedAtColumn() => $this->formatTimestamp($template->created_at),
        ];
    }
}
