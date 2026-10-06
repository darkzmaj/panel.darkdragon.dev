<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\ProfileAvatarUsernameTest;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class);

beforeEach(function (): void {
    Storage::fake('local');
    $this->installGobia(['gobia-core']);
});
afterEach(fn () => $this->uninstallGobia());

function makePng(int $width, int $height): string
{
    $image = imagecreatetruecolor($width, $height);
    imagefill($image, 0, 0, (int) imagecolorallocate($image, 20, 120, 220));
    ob_start();
    imagepng($image);

    return (string) ob_get_clean();
}

function fakeUpload(string $bytes, string $name = 'a.png'): UploadedFile
{
    return UploadedFile::fake()->createWithContent($name, $bytes);
}

const PROFILE_URL = '/api/client/extensions/gobia-core/profile';

test('an uploaded PNG becomes a 256 pixel square served from the extension file store', function (): void {
    $user = User::factory()->create();
    $response = $this->actingAs($user)->post(PROFILE_URL.'/avatar', ['avatar' => fakeUpload(makePng(400, 300), 'me.php')], ['Accept' => 'application/json'])->assertOk();
    $url = $response->json('avatar_url');
    expect($url)->toStartWith('/extension-files/gobia-core/')->toEndWith('.png')->not->toContain('me');

    $this->app['auth']->forgetGuards();
    $served = $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/png');
    [$w, $h] = getimagesizefromstring((string) $served->getContent());
    expect([$w, $h])->toBe([256, 256]);
});

test('smuggled trailing data and metadata do not survive re-encoding', function (): void {
    $user = User::factory()->create();
    $dirty = makePng(64, 64).'<?php system($_GET["x"]); ?>SECRET-TRAILER';
    $url = $this->actingAs($user)->post(PROFILE_URL.'/avatar', ['avatar' => fakeUpload($dirty)], ['Accept' => 'application/json'])->assertOk()->json('avatar_url');
    $this->app['auth']->forgetGuards();
    $body = $this->get($url)->assertOk()->getContent() ?: '';
    expect($body)->not->toContain('SECRET-TRAILER')->not->toContain('<?php');
});

test('non PNG files, oversized dimensions and oversized files are rejected', function (): void {
    $user = User::factory()->create();
    $headers = ['Accept' => 'application/json'];
    $this->actingAs($user);
    $this->post(PROFILE_URL.'/avatar', ['avatar' => fakeUpload('<?php echo 1;')], $headers)->assertUnprocessable();
    $this->post(PROFILE_URL.'/avatar', ['avatar' => fakeUpload('<svg xmlns="http://www.w3.org/2000/svg"/>')], $headers)->assertUnprocessable();
    $this->post(PROFILE_URL.'/avatar', ['avatar' => fakeUpload(makePng(5000, 1))], $headers)->assertUnprocessable();
    $this->post(PROFILE_URL.'/avatar', ['avatar' => fakeUpload(makePng(32, 32).str_repeat("\0", 3 * 1024 * 1024))], $headers)->assertUnprocessable();
    $this->post(PROFILE_URL.'/avatar', [], $headers)->assertUnprocessable();
    expect(Storage::disk('local')->allFiles())->toBe([]);
    $this->getJson(PROFILE_URL)->assertJsonPath('avatar_url', null);
});

test('replacing an avatar deletes the old file and removing it restores the generated avatar', function (): void {
    $user = User::factory()->create();
    $this->actingAs($user);
    $first = $this->post(PROFILE_URL.'/avatar', ['avatar' => fakeUpload(makePng(100, 100))], ['Accept' => 'application/json'])->json('avatar_url');
    $second = $this->post(PROFILE_URL.'/avatar', ['avatar' => fakeUpload(makePng(120, 120))], ['Accept' => 'application/json'])->json('avatar_url');
    expect($second)->not->toBe($first);
    expect(Storage::disk('local')->allFiles())->toHaveCount(1);
    $this->deleteJson(PROFILE_URL.'/avatar')->assertOk()->assertJsonPath('avatar_url', null);
    expect(Storage::disk('local')->allFiles())->toBe([]);
});

test('avatars are per user and require authentication', function (): void {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $this->post(PROFILE_URL.'/avatar', ['avatar' => fakeUpload(makePng(10, 10))], ['Accept' => 'application/json'])->assertUnauthorized();
    $this->actingAs($a)->post(PROFILE_URL.'/avatar', ['avatar' => fakeUpload(makePng(10, 10))], ['Accept' => 'application/json'])->assertOk();
    $this->actingAs($b)->getJson(PROFILE_URL)->assertJsonPath('avatar_url', null);
});

test('changing the username needs the current password and follows the panel rules', function (): void {
    $user = User::factory()->create(['password' => Hash::make('correct-horse-battery')]);
    $this->actingAs($user);

    $this->putJson(PROFILE_URL.'/username', ['username' => 'new.name', 'password' => 'wrong'])->assertStatus(400);
    expect($user->fresh()->username)->not->toBe('new.name');

    $this->putJson(PROFILE_URL.'/username', ['username' => 'new.name', 'password' => 'correct-horse-battery'])->assertOk()->assertJsonPath('username', 'new.name');
    expect($user->fresh()->username)->toBe('new.name');

    foreach (['', '-bad', 'bad-', 'sp ace', str_repeat('a', 200), "x\ny"] as $invalid) {
        $this->putJson(PROFILE_URL.'/username', ['username' => $invalid, 'password' => 'correct-horse-battery'])->assertUnprocessable();
    }
    $this->putJson(PROFILE_URL.'/username', ['password' => 'correct-horse-battery'])->assertUnprocessable();
    expect($user->fresh()->username)->toBe('new.name');
});

test('a username cannot take another user\'s name, whatever the case', function (): void {
    $taken = User::factory()->create(['username' => 'already.used']);
    $user = User::factory()->create(['password' => Hash::make('correct-horse-battery')]);
    $this->actingAs($user)->putJson(PROFILE_URL.'/username', ['username' => 'Already.Used', 'password' => 'correct-horse-battery'])->assertUnprocessable();
    expect($taken->fresh()->username)->toBe('already.used');
});
