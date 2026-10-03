<?php

namespace Pterodactyl\Http\Requests\Api\Client\Account;

use Pterodactyl\Models\User;
use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;

class UpdateUsernameRequest extends ClientApiRequest
{
    public function rules(): array
    {
        $rules = User::getRulesForUpdate($this->user());

        return ['username' => $rules['username']];
    }
}
