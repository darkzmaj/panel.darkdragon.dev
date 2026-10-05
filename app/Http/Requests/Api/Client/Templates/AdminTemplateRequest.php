<?php

namespace Pterodactyl\Http\Requests\Api\Client\Templates;

use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;

/**
 * Creating instances from templates in the dashboard is an administrator feature. Templates stay admin-only to
 * manage, and the same applies to using them from the browser.
 */
class AdminTemplateRequest extends ClientApiRequest
{
    public function authorize(): bool
    {
        return (bool) $this->user()->root_admin;
    }
}
