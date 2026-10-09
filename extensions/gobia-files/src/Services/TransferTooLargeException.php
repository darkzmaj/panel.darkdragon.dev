<?php

declare(strict_types=1);

namespace GobiaFiles\Services;

use RuntimeException;

/** A file is larger than the most one transfer carries. */
final class TransferTooLargeException extends RuntimeException
{
    public function __construct(public readonly int $limit)
    {
        parent::__construct('The file is larger than a transfer carries.');
    }
}
