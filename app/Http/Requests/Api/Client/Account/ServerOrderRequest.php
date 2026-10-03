<?php

namespace Pterodactyl\Http\Requests\Api\Client\Account;

use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;

class ServerOrderRequest extends ClientApiRequest
{
    public function rules(): array
    {
        return [
            'servers' => 'required|array|max:1000',
            'servers.*' => 'string|size:36',
        ];
    }
}
