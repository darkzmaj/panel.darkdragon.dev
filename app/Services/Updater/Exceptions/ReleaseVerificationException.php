<?php

namespace Pterodactyl\Services\Updater\Exceptions;

/**
 * A release package failed integrity or authenticity checks. Nothing from it may be installed.
 */
class ReleaseVerificationException extends UpdateException
{
}
