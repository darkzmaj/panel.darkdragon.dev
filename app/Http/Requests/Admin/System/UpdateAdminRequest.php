<?php

namespace Pterodactyl\Http\Requests\Admin\System;

use Pterodactyl\Http\Requests\Admin\AdminFormRequest;

/**
 * Authorization for every updater endpoint: root administrators only, enforced on the server.
 */
class UpdateAdminRequest extends AdminFormRequest
{
    public function rules(): array
    {
        return [];
    }
}
