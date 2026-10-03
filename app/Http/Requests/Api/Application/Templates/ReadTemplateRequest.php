<?php

namespace Pterodactyl\Http\Requests\Api\Application\Templates;

use Pterodactyl\Services\Acl\Api\AdminAcl;

class ReadTemplateRequest extends TemplateApiRequest
{
    protected ?string $resource = AdminAcl::RESOURCE_TEMPLATES;

    protected int $permission = AdminAcl::READ;
}
