<?php

namespace Pterodactyl\Tests\Unit\Services\Updater;

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Pterodactyl\Services\Updater\SafeTarExtractor;
use Pterodactyl\Tests\Unit\Services\Updater\Support\TarBuilder;
use Pterodactyl\Services\Updater\Exceptions\ReleaseVerificationException;

class SafeTarExtractorTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/gobia-tar-test-' . bin2hex(random_bytes(4));
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->dir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST) as $item) {
            $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
        }
        @rmdir($this->dir);
    }

    private function extract(string $gz, ?SafeTarExtractor $extractor = null): array
    {
        file_put_contents($archive = $this->dir . '/a.tar.gz', $gz);

        return ($extractor ?? new SafeTarExtractor())->extract($archive, $this->dir . '/out');
    }

    public function testExtractsFilesAndDirectories(): void
    {
        $stats = $this->extract((new TarBuilder())->dir('./app')->file('./app/a.php', '<?php')->file('VERSION', "1\n")->build());

        $this->assertSame(['files' => 2, 'bytes' => 7], $stats);
        $this->assertSame('<?php', file_get_contents($this->dir . '/out/app/a.php'));
    }

    public function testTheArchiveRootEntryWrittenByTarIsAccepted(): void
    {
        $stats = $this->extract((new TarBuilder())->dir('.')->file('./a.txt', 'x')->build());

        $this->assertSame(1, $stats['files']);
    }

    public function testTheEnvironmentTemplateIsAllowedButRealEnvironmentFilesAreNot(): void
    {
        $this->assertSame(1, $this->extract((new TarBuilder())->file('.env.example', 'APP_ENV=production')->build())['files']);
    }

    public function testLongPathsUsingThePrefixFieldAreSupported(): void
    {
        $path = str_repeat('d/', 60) . 'file.txt';
        $this->extract((new TarBuilder())->file($path, 'ok')->build());

        $this->assertSame('ok', file_get_contents($this->dir . '/out/' . $path));
    }

    #[DataProvider('hostileArchives')]
    public function testHostileArchivesAreRejectedBeforeAnythingEscapes(callable $build): void
    {
        $this->expectException(ReleaseVerificationException::class);

        try {
            $this->extract($build());
        } finally {
            // Nothing may have been written outside of the destination.
            $this->assertFileDoesNotExist($this->dir . '/evil.txt');
            $this->assertFileDoesNotExist(dirname($this->dir) . '/evil.txt');
        }
    }

    public static function hostileArchives(): array
    {
        return [
            'parent traversal' => [fn () => (new TarBuilder())->file('../evil.txt', 'x')->build()],
            'nested traversal' => [fn () => (new TarBuilder())->file('app/../../evil.txt', 'x')->build()],
            'absolute path' => [fn () => (new TarBuilder())->file('/tmp/evil.txt', 'x')->build()],
            'windows drive' => [fn () => (new TarBuilder())->file('C:/evil.txt', 'x')->build()],
            'backslash traversal' => [fn () => (new TarBuilder())->file('..\\evil.txt', 'x')->build()],
            'alternate stream' => [fn () => (new TarBuilder())->file('app/a.php:evil', 'x')->build()],
            'device name' => [fn () => (new TarBuilder())->file('app/nul.txt', 'x')->build()],
            'symlink' => [fn () => (new TarBuilder())->symlink('app/link', '/etc/passwd')->build()],
            'hardlink' => [fn () => (new TarBuilder())->file('a', 'x')->hardlink('b', 'a')->build()],
            'character device' => [fn () => (new TarBuilder())->entry('dev', '3', '', 0644)->build()],
            'env file' => [fn () => (new TarBuilder())->file('.env', 'APP_KEY=x')->build()],
            'env variant' => [fn () => (new TarBuilder())->file('.env.production', 'x')->build()],
            'storage dir' => [fn () => (new TarBuilder())->file('storage/app/private/avatars/a.png', 'x')->build()],
            'git dir' => [fn () => (new TarBuilder())->file('.git/config', 'x')->build()],
            'duplicate entry' => [fn () => (new TarBuilder())->file('a', '1')->file('a', '2')->build()],
            'empty name' => [fn () => (new TarBuilder())->file('./', 'x')->build()],
            'missing end marker' => [fn () => (new TarBuilder())->file('a', 'x')->build(false)],
            'not gzip' => [fn () => 'this is not an archive at all'],
            'empty file' => [fn () => ''],
        ];
    }

    public function testTruncatedArchiveIsRejected(): void
    {
        $full = gzdecode((new TarBuilder())->file('a.bin', str_repeat('A', 5000))->build());
        // Cut in the middle of the file body.
        $this->expectException(ReleaseVerificationException::class);
        $this->extract(gzencode(substr($full, 0, 1500)));
    }

    public function testTruncatedGzipStreamIsRejected(): void
    {
        $gz = (new TarBuilder())->file('a.bin', random_bytes(20000))->build();
        $this->expectException(ReleaseVerificationException::class);
        $this->extract(substr($gz, 0, (int) (strlen($gz) * 0.6)));
    }

    public function testCorruptHeaderChecksumIsRejected(): void
    {
        $tar = gzdecode((new TarBuilder())->file('a', 'x')->build());
        $tar[10] = chr(ord($tar[10]) ^ 0xFF);

        $this->expectException(ReleaseVerificationException::class);
        $this->extract(gzencode($tar));
    }

    public function testExpandedSizeLimitIsEnforced(): void
    {
        $this->expectException(ReleaseVerificationException::class);
        $this->extract((new TarBuilder())->file('big', str_repeat('0', 4096))->build(), new SafeTarExtractor(1000));
    }

    public function testEntryCountLimitIsEnforced(): void
    {
        $tar = new TarBuilder();
        foreach (range(1, 10) as $i) {
            $tar->file("f$i", 'x');
        }

        $this->expectException(ReleaseVerificationException::class);
        $this->extract($tar->build(), new SafeTarExtractor(1024 * 1024, 5));
    }
}
