<?php

declare(strict_types=1);

namespace GobiaCore\Updater\Exceptions;

/**
 * A failure during an update. The message is written for administrators and must never contain secrets.
 */
class UpdateException extends \RuntimeException
{
}
