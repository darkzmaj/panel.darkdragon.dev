<?php

namespace Pterodactyl\Tests\Unit\Services\Updater;

use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Pterodactyl\Services\Updater\ReleaseInfo;
use Illuminate\Http\Client\ConnectionException;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;
use Pterodactyl\Services\Updater\Providers\GitHubReleaseProvider;

class GitHubReleaseProviderTest extends UpdaterTestCase
{
    // Assembled at runtime so the file never contains something that looks like a real credential.
    private static function token(): string
    {
        return sprintf('github%s_FAKEFAKEFAKEFAKEFAKE_notarealtokennotarealtoken', '_pat');
    }

    private function provider(string|false|null $token = false): GitHubReleaseProvider
    {
        return new GitHubReleaseProvider('Cryvex-Dev/panel.gobia.cloud', $token === false ? self::token() : $token, 1024 * 1024);
    }

    private function release(string $tag, array $overrides = []): array
    {
        $version = ltrim($tag, 'v');

        return $overrides + [
            'tag_name' => $tag,
            'draft' => false,
            'prerelease' => false,
            'published_at' => '2026-10-03T12:00:00Z',
            'body' => 'Notes for ' . $version,
            'assets' => [
                ['id' => 11, 'name' => 'release.json'],
                ['id' => 12, 'name' => 'panel-' . $version . '.tar.gz'],
            ],
        ];
    }

    private function meta(string $version, array $overrides = []): string
    {
        return json_encode($overrides + ['version' => $version, 'sha256' => str_repeat('a', 64), 'size' => 100, 'migrations' => true, 'requires_restart' => true, 'signature' => 'sig']);
    }

    public function testLatestReleaseIsTheHighestStableVersion(): void
    {
        Http::fake([
            'api.github.com/repos/*/releases?*' => Http::response([
                $this->release('v1.15.1-gobia.2'),
                $this->release('v1.15.1-gobia.10'),
                $this->release('v1.16.0-gobia.1', ['prerelease' => true]),
                $this->release('v1.17.0-gobia.1', ['draft' => true]),
                $this->release('v1.18.0'),
                $this->release('v1.15.1-gobia.9', ['assets' => []]),
            ]),
            'api.github.com/repos/*/releases/assets/11' => Http::response($this->meta('1.15.1-gobia.10')),
        ]);

        $release = $this->provider()->latest();

        $this->assertInstanceOf(ReleaseInfo::class, $release);
        $this->assertSame('1.15.1-gobia.10', $release->version);
        $this->assertSame('12', $release->packageRef);
        $this->assertSame('Notes for 1.15.1-gobia.10', $release->notes);
        $this->assertTrue($release->migrations);
    }

    public function testRequestsAreAuthenticatedWithTheTokenAndOnlyToGitHub(): void
    {
        Http::fake(['*' => Http::response([])]);

        $this->provider()->latest();

        Http::assertSent(fn (Request $request) => $request->hasHeader('Authorization', 'Bearer ' . self::token())
            && str_starts_with($request->url(), 'https://api.github.com/repos/Cryvex-Dev/panel.gobia.cloud/'));
    }

    public function testNoAuthorizationHeaderIsSentWithoutAToken(): void
    {
        Http::fake(['*' => Http::response([])]);

        $this->provider(null)->latest();

        Http::assertSent(fn (Request $request) => !$request->hasHeader('Authorization'));
    }

    public function testAuthenticationFailureGivesAHelpfulMessageWithoutLeakingTheToken(): void
    {
        Http::fake(['*' => Http::response(['message' => 'Bad credentials ' . self::token()], 401)]);

        try {
            $this->provider()->latest();
            $this->fail('Expected an exception');
        } catch (UpdateException $exception) {
            $this->assertStringContainsString('rejected the update token', $exception->getMessage());
            $this->assertStringNotContainsString(self::token(), $exception->getMessage());
        }
    }

    public function testMissingRepositoryExplainsPrivateRepositoryAccess(): void
    {
        Http::fake(['*' => Http::response(['message' => 'Not Found'], 404)]);

        $this->expectExceptionMessage('private');
        $this->provider()->latest();
    }

    public function testRateLimitOrForbiddenIsReported(): void
    {
        Http::fake(['*' => Http::response(['message' => 'rate limit'], 403)]);

        $this->expectExceptionMessage('denied access');
        $this->provider()->latest();
    }

    public function testNetworkFailureIsReportedAsConnectivityProblem(): void
    {
        Http::fake(fn () => throw new ConnectionException('cURL error 28: timeout with ' . self::token()));

        try {
            $this->provider()->latest();
            $this->fail('Expected an exception');
        } catch (UpdateException $exception) {
            $this->assertStringContainsString('Could not reach GitHub', $exception->getMessage());
            $this->assertStringNotContainsString(self::token(), $exception->getMessage());
        }
    }

    public function testMetadataForADifferentVersionThanTheTagIsRejected(): void
    {
        Http::fake([
            'api.github.com/repos/*/releases?*' => Http::response([$this->release('v1.15.1-gobia.2')]),
            'api.github.com/repos/*/releases/assets/11' => Http::response($this->meta('1.15.1-gobia.9')),
        ]);

        $this->expectExceptionMessage('does not match the release tag');
        $this->provider()->latest();
    }

    public function testMalformedMetadataIsRejected(): void
    {
        Http::fake([
            'api.github.com/repos/*/releases?*' => Http::response([$this->release('v1.15.1-gobia.2')]),
            'api.github.com/repos/*/releases/assets/11' => Http::response('<html>not json</html>'),
        ]);

        $this->expectException(UpdateException::class);
        $this->provider()->latest();
    }

    public function testFindIgnoresInvalidVersionsWithoutCallingGitHub(): void
    {
        Http::fake();

        $this->assertNull($this->provider()->find('../../etc/passwd'));
        $this->assertNull($this->provider()->find('1.15.1'));
        Http::assertNothingSent();
    }

    public function testPackageIsDownloadedFromTheAssetEndpointOfThatRepository(): void
    {
        Http::fake(['api.github.com/repos/*/releases/assets/12' => Http::response('PACKAGE-BYTES')]);
        $release = new ReleaseInfo('1.15.1-gobia.2', str_repeat('a', 64), 13, true, true, 'sig', null, '', '12');

        $this->provider()->download($release, $destination = $this->state . '/panel.tar.gz');

        $this->assertSame('PACKAGE-BYTES', file_get_contents($destination));
        Http::assertSent(fn (Request $request) => $request->url() === 'https://api.github.com/repos/Cryvex-Dev/panel.gobia.cloud/releases/assets/12'
            && $request->hasHeader('Accept', 'application/octet-stream'));
    }

    public function testDownloadInterruptionIsReported(): void
    {
        Http::fake(fn () => throw new ConnectionException('connection reset'));
        $release = new ReleaseInfo('1.15.1-gobia.2', str_repeat('a', 64), 13, true, true, 'sig', null, '', '12');

        $this->expectExceptionMessage('interrupted');
        $this->provider()->download($release, $this->state . '/panel.tar.gz');
    }

    public function testDownloadReferenceMustBeNumeric(): void
    {
        Http::fake();
        $release = new ReleaseInfo('1.15.1-gobia.2', str_repeat('a', 64), 13, true, true, 'sig', null, '', '12/../../../user');

        $this->expectException(UpdateException::class);
        $this->provider()->download($release, $this->state . '/panel.tar.gz');
        Http::assertNothingSent();
    }

    public function testRepositoryMustLookLikeOwnerSlashName(): void
    {
        $this->expectException(UpdateException::class);
        new GitHubReleaseProvider('https://evil.example/x/y', null, 10);
    }
}
