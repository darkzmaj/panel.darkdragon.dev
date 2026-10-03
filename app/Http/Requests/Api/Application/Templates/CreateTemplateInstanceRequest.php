<?php

namespace Pterodactyl\Http\Requests\Api\Application\Templates;

use Pterodactyl\Services\Acl\Api\AdminAcl;

class CreateTemplateInstanceRequest extends TemplateApiRequest
{
    protected ?string $resource = AdminAcl::RESOURCE_TEMPLATE_INSTANCE_CREATE;

    protected int $permission = AdminAcl::WRITE;
}
