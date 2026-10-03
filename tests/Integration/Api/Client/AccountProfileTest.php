<?php

namespace Pterodactyl\Tests\Integration\Api\Client;

use Pterodactyl\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;

class AccountProfileTest extends ClientApiIntegrationTestCase
{
    public function setUp(): void
    {
        parent::setUp();

        defined('LARAVEL_START') || define('LARAVEL_START', microtime(true));

        Storage::fake('local');
    }

    public static function pngBytes(int $width = 32, int $height = 32): string
    {
        $image = imagecreatetruecolor($width, $height);
        ob_start();
        imagepng($image);

        return ob_get_clean();
    }

    public function testUsernameIsUpdatedAndNormalized(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->putJson('/api/client/account/username', ['username' => 'New.Name-42'])
            ->assertOk()
            ->assertJson(['username' => 'new.name-42']);

        $this->assertDatabaseHas('users', ['id' => $user->id, 'uuid' => $user->uuid, 'username' => 'new.name-42']);
        $this->assertActivityFor('user:account.username-changed', $user, $user);
    }

    public function testInvalidOrTakenUsernameIsRejected(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();

        foreach (['-bad', 'bad-', 'has space', 'a', str_repeat('a', 200), $other->username] as $username) {
            $this->actingAs($user)
                ->putJson('/api/client/account/username', ['username' => $username])
                ->assertUnprocessable();
        }

        $this->assertSame($user->username, $user->fresh()->username);
    }

    public function testUsernameChangeKeepsOwnership(): void
    {
        [$user, $server] = $this->generateTestAccount();

        $this->actingAs($user)->putJson('/api/client/account/username', ['username' => 'renamed.user'])->assertOk();

        $this->assertSame($user->id, $server->fresh()->owner_id);
        $this->actingAs($user->fresh())->getJson('/api/client/servers/' . $server->uuid)->assertOk();
    }

    public function testPngAvatarCanBeUploadedReplacedAndRemoved(): void
    {
        $user = User::factory()->create();

        $url = $this->actingAs($user)
            ->post('/api/client/account/avatar', ['avatar' => UploadedFile::fake()->createWithContent('me.png', self::pngBytes(600, 400))], ['Accept' => 'application/json'])
            ->assertOk()
            ->json('avatar_url');

        $user->refresh();
        $this->assertSame('/avatars/' . $user->uuid . '?v=' . $user->avatar_hash, $url);
        Storage::disk('local')->assertExists('avatars/' . $user->uuid . '.png');

        // Avatars are centre-cropped to a square and scaled down, never up.
        [$width, $height] = getimagesizefromstring(Storage::disk('local')->get('avatars/' . $user->uuid . '.png'));
        $this->assertSame([256, 256], [$width, $height]);

        $previous = $user->avatar_hash;
        $this->actingAs($user)
            ->post('/api/client/account/avatar', ['avatar' => UploadedFile::fake()->createWithContent('other.png', self::pngBytes(16, 16))], ['Accept' => 'application/json'])
            ->assertOk();
        $this->assertNotSame($previous, $user->fresh()->avatar_hash);

        $this->actingAs($user)->deleteJson('/api/client/account/avatar')->assertNoContent();
        $this->assertNull($user->fresh()->avatar_hash);
        Storage::disk('local')->assertMissing('avatars/' . $user->uuid . '.png');
    }

    public function testAvatarIsServedToSignedInUsersOnly(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user)
            ->post('/api/client/account/avatar', ['avatar' => UploadedFile::fake()->createWithContent('me.png', self::pngBytes())], ['Accept' => 'application/json'])
            ->assertOk();

        $url = $user->fresh()->avatar_url;

        $this->actingAs(User::factory()->create(), 'web')->get($url)
            ->assertOk()
            ->assertHeader('Content-Type', 'image/png')
            ->assertHeader('X-Content-Type-Options', 'nosniff');

        $this->app['auth']->forgetGuards();
        $this->get($url)->assertUnauthorized();
    }

    #[DataProvider('invalidAvatarProvider')]
    public function testNonPngAvatarsAreRejected(string $name, string $contents): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->post('/api/client/account/avatar', ['avatar' => UploadedFile::fake()->createWithContent($name, $contents)], ['Accept' => 'application/json'])
            ->assertUnprocessable();

        $this->assertNull($user->fresh()->avatar_hash);
        Storage::disk('local')->assertMissing('avatars/' . $user->uuid . '.png');
    }

    public static function invalidAvatarProvider(): array
    {
        $image = imagecreatetruecolor(8, 8);
        $encode = function (callable $fn) use ($image) {
            ob_start();
            $fn($image);

            return ob_get_clean();
        };

        $jpeg = $encode('imagejpeg');
        $gif = $encode('imagegif');
        $webp = $encode('imagewebp');
        $svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

        return [
            'jpg' => ['a.jpg', $jpeg],
            'jpeg' => ['a.jpeg', $jpeg],
            'gif' => ['a.gif', $gif],
            'webp' => ['a.webp', $webp],
            'svg' => ['a.svg', $svg],
            'jpeg renamed to png' => ['a.png', $jpeg],
            'gif renamed to png' => ['a.png', $gif],
            'svg renamed to png' => ['a.png', $svg],
            'php renamed to png' => ['a.png', '<?php echo 1;'],
            'real png with wrong extension' => ['a.jpg', self::pngBytes()],
            'png signature only' => ['a.png', "\x89PNG\r\n\x1a\n" . str_repeat('A', 64)],
            'oversized dimensions' => ['a.png', self::pngBytes(4097, 8)],
        ];
    }

    public function testOversizedAvatarIsRejected(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->post('/api/client/account/avatar', ['avatar' => UploadedFile::fake()->createWithContent('big.png', self::pngBytes() . str_repeat('0', 3 * 1024 * 1024))], ['Accept' => 'application/json'])
            ->assertUnprocessable();
        $this->assertNull($user->fresh()->avatar_hash);
    }

    public function testClientFilenameIsNeverUsedAsStoragePath(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->post('/api/client/account/avatar', ['avatar' => UploadedFile::fake()->createWithContent('../../../evil.php.png', self::pngBytes())], ['Accept' => 'application/json'])
            ->assertOk();

        $this->assertSame(['avatars/' . $user->uuid . '.png'], Storage::disk('local')->allFiles());
    }
}
