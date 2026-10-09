<?php

declare(strict_types=1);

namespace GobiaCore\Updater\Exceptions;

/** Another update or rollback holds the exclusive lock. */
class UpdateInProgressException extends UpdateException
{
    public function __construct(public readonly string $updateId)
    {
        parent::__construct('Another update is already running.');
    }
}
