<?php

namespace Pterodactyl\Services\Updater\Exceptions;

/**
 * A failure during an update. The message is written for administrators and must never contain secrets.
 */
class UpdateException extends \RuntimeException
{
}
