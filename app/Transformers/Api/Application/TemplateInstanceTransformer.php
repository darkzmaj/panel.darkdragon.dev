<?php

namespace Pterodactyl\Transformers\Api\Application;

use Pterodactyl\Models\TemplateInstance;

class TemplateInstanceTransformer extends BaseTransformer
{
    public function getResourceName(): string
    {
        return TemplateInstance::RESOURCE_NAME;
    }

    public function transform(TemplateInstance $instance): array
    {
        return [
            'id' => $instance->uuid,
            'template' => $instance->template_id,
            'template_revision' => $instance->template_revision,
            'name' => $instance->name,
            'owner' => $instance->owner_id,
            'state' => $instance->state,
            'finished' => $instance->isFinished(),
            'failed_stage' => $instance->failed_stage,
            'error' => $instance->error,
            'attempts' => $instance->attempts,
            'server' => $instance->server_id,
            'node' => $instance->node_id,
            'expires_at' => $instance->expires_at ? $this->formatTimestamp($instance->expires_at) : null,
            $instance->getUpdatedAtColumn() => $this->formatTimestamp($instance->updated_at),
            $instance->getCreatedAtColumn() => $this->formatTimestamp($instance->created_at),
        ];
    }
}
