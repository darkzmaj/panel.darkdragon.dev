<?php

namespace Pterodactyl\Http\Requests\Api\Client\Account;

use Pterodactyl\Rules\PngImage;
use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;

class UpdateAvatarRequest extends ClientApiRequest
{
    public function rules(): array
    {
        return [
            'avatar' => ['bail', 'required', 'file', 'extensions:png', 'max:2048', new PngImage()],
        ];
    }
}
