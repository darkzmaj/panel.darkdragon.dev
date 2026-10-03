<?php

namespace Pterodactyl\Tests\Unit\Services\Updater;

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Pterodactyl\Services\Updater\VersionComparator;

class VersionComparatorTest extends TestCase
{
    public function testGobiaCounterOrdersReleasesOfTheSameUpstream(): void
    {
        $this->assertTrue(VersionComparator::isNewer('1.15.1-gobia.2', '1.15.1-gobia.1'));
        $this->assertTrue(VersionComparator::isNewer('1.15.1-gobia.10', '1.15.1-gobia.9'));
        $this->assertFalse(VersionComparator::isNewer('1.15.1-gobia.1', '1.15.1-gobia.1'));
        $this->assertFalse(VersionComparator::isNewer('1.15.1-gobia.1', '1.15.1-gobia.2'));
    }

    public function testUpstreamPartIsComparedNumerically(): void
    {
        $this->assertTrue(VersionComparator::isNewer('1.15.10-gobia.1', '1.15.9-gobia.5'));
        $this->assertTrue(VersionComparator::isNewer('1.16.0-gobia.1', '1.15.99-gobia.9'));
        $this->assertTrue(VersionComparator::isNewer('2.0.0-gobia.1', '1.99.99-gobia.99'));
        $this->assertSame(0, VersionComparator::compare('1.15.1-gobia.1', '1.15.1-gobia.1'));
    }

    #[DataProvider('invalidVersions')]
    public function testMalformedVersionsAreRejected(mixed $version): void
    {
        $this->assertFalse(VersionComparator::isValid($version));
    }

    public static function invalidVersions(): array
    {
        return [
            'upstream only' => ['1.15.1'],
            'no counter' => ['1.15.1-gobia'],
            'wrong suffix' => ['1.15.1-beta.1'],
            'prerelease' => ['1.15.1-gobia.1-rc.1'],
            'leading v' => ['v1.15.1-gobia.1'],
            'path traversal' => ['../../etc/passwd'],
            'traversal suffix' => ['1.15.1-gobia.1/../../x'],
            'shell metachar' => ['1.15.1-gobia.1; rm -rf /'],
            'newline' => ["1.15.1-gobia.1\n"],
            'null byte' => ["1.15.1-gobia.1\0"],
            'backslash' => ['1.15.1-gobia.1\\..'],
            'empty' => [''],
            'array' => [['1.15.1-gobia.1']],
            'null' => [null],
            'huge' => ['1.15.99999-gobia.1'],
        ];
    }

    public function testTagsAreMappedToVersions(): void
    {
        $this->assertSame('1.15.1-gobia.2', VersionComparator::fromTag('v1.15.1-gobia.2'));
        $this->assertNull(VersionComparator::fromTag('v1.15.1'));
        $this->assertNull(VersionComparator::fromTag('release-3'));
    }
}
