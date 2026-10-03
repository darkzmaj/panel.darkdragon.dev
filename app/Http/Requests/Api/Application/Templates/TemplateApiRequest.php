<?php

namespace Pterodactyl\Http\Requests\Api\Application\Templates;

use Pterodactyl\Models\ApiKey;
use Pterodactyl\Services\Acl\Api\AdminAcl;
use Pterodactyl\Http\Requests\Api\Application\ApplicationApiRequest;

/**
 * Template endpoints are stricter than the rest of the Application API: they only accept an Application API
 * key that was explicitly granted the matching template permission. Session logins and account (client) keys
 * of an administrator are not enough, so creating servers from templates is always a deliberate grant.
 */
abstract class TemplateApiRequest extends ApplicationApiRequest
{
    public function authorize(): bool
    {
        $token = $this->user()?->currentAccessToken();
        if (!$token instanceof ApiKey || $token->key_type !== ApiKey::TYPE_APPLICATION) {
            return false;
        }

        return AdminAcl::check($token, $this->resource, $this->permission);
    }
}
