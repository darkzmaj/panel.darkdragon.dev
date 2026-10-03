<?php

namespace Pterodactyl\Services\Updater;

final class ProcessResult
{
    public function __construct(
        public readonly int $exitCode,
        public readonly string $output,
        public readonly string $error,
    ) {
    }

    public function successful(): bool
    {
        return $this->exitCode === 0;
    }
}
