<?php

namespace GobiaTemplates\Support;

use Pterodactyl\Exceptions\DisplayException;

class PlacementException extends DisplayException
{
    /**
     * @param array<int, string> $reasons per node explanation, keyed by node name
     */
    public function __construct(string $message, private array $reasons = [])
    {
        parent::__construct($message);
    }

    /**
     * @return array<int, string>
     */
    public function getReasons(): array
    {
        return $this->reasons;
    }
}
