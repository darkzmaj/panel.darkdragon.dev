<?php

namespace Pterodactyl\Http\Requests\Api\Client\Account;

use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;

class UpdateAccessRequest extends ClientApiRequest
{
    public function rules(): array
    {
        return [
            'all_servers' => 'sometimes|boolean',
            'servers' => 'required_without:all_servers|array|max:500',
            'servers.*' => 'string|size:36',
            'all_permissions' => 'sometimes|boolean',
            'permissions' => 'required_without:all_permissions|array|max:200',
            'permissions.*' => 'string|max:64',
        ];
    }
}
