<?php

declare(strict_types=1);

namespace GobiaBackups\Storage;

use GobiaBackups\Models\Destination;

/** Opens the store for a destination. Bound in the container so tests can substitute a store that needs no network. */
class StoreFactory
{
    public function open(Destination $destination): RemoteStore
    {
        return new StorageBoxStore($destination);
    }

    /** A connection that reads the host key without checking it or logging in: only for showing it to an administrator. */
    public function probe(Destination $destination): RemoteStore
    {
        return new StorageBoxStore($destination, verifyHostKey: false);
    }
}
