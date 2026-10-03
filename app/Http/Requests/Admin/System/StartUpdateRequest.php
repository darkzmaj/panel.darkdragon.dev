<?php

namespace Pterodactyl\Http\Requests\Admin\System;

use Pterodactyl\Services\Updater\VersionComparator;

class StartUpdateRequest extends UpdateAdminRequest
{
    public function rules(): array
    {
        return [
            'version' => ['required', 'string', 'max:32', 'regex:' . VersionComparator::PATTERN],
        ];
    }
}
