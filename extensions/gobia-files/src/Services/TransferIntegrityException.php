<?php

declare(strict_types=1);

namespace GobiaFiles\Services;

use RuntimeException;

/** A file did not arrive at the destination exactly as it left the source. */
final class TransferIntegrityException extends RuntimeException {}
