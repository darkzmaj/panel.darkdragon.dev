<?php

namespace Pterodactyl\Services\Updater\Providers;

use Pterodactyl\Services\Updater\ReleaseInfo;

/**
 * A source of Panel releases. Implementations are configured by the operator, never by request input.
 */
interface ReleaseProvider
{
    /**
     * Returns the newest published stable release, or null if there are none.
     *
     * @throws \Pterodactyl\Services\Updater\Exceptions\UpdateException
     */
    public function latest(): ?ReleaseInfo;

    /**
     * Returns a specific published release, or null if the source does not offer it.
     *
     * @throws \Pterodactyl\Services\Updater\Exceptions\UpdateException
     */
    public function find(string $version): ?ReleaseInfo;

    /**
     * Streams the release package to the given file path.
     *
     * @throws \Pterodactyl\Services\Updater\Exceptions\UpdateException
     */
    public function download(ReleaseInfo $release, string $destination): void;
}
