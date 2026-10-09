<?php

declare(strict_types=1);

namespace GobiaCore\Updater\Exceptions;

/** The installation is not ready for the release; carries the preflight report so the caller can show why. */
class PreflightFailedException extends UpdateException
{
    /** @param array<string, mixed> $report */
    public function __construct(public readonly array $report)
    {
        parent::__construct('This installation is not ready for the update.');
    }
}
