<?php

namespace Pterodactyl\Http\Requests\Api\Client\Account;

use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;

class ServerCategoryRequest extends ClientApiRequest
{
    public function rules(): array
    {
        return [
            'name' => 'required|string|between:1,32',
            'servers' => 'sometimes|array|max:1000',
            'servers.*' => 'string|size:36',
        ];
    }
}
