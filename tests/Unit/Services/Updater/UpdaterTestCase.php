<?php

namespace Pterodactyl\Tests\Unit\Services\Updater;

use Pterodactyl\Tests\TestCase;
use Pterodactyl\Tests\Unit\Services\Updater\Support\UpdaterHelpers;

abstract class UpdaterTestCase extends TestCase
{
    use UpdaterHelpers;

    public function setUp(): void
    {
        parent::setUp();
        $this->setUpUpdater();
    }

    public function tearDown(): void
    {
        $this->tearDownUpdater();
        parent::tearDown();
    }
}
