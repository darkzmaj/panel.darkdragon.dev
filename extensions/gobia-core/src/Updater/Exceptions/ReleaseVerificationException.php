<?php

declare(strict_types=1);

namespace GobiaCore\Updater\Exceptions;

/**
 * A release package failed integrity or authenticity checks. Nothing from it may be installed.
 */
class ReleaseVerificationException extends UpdateException
{
}
