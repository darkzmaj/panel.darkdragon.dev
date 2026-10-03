<?php

namespace Pterodactyl\Http\Requests\Api\Application\Templates;

use Pterodactyl\Services\Acl\Api\AdminAcl;

class DeleteTemplateInstanceRequest extends TemplateApiRequest
{
    protected ?string $resource = AdminAcl::RESOURCE_TEMPLATE_INSTANCE_DELETE;

    protected int $permission = AdminAcl::WRITE;
}
