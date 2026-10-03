<?php

namespace Pterodactyl\Tests\Integration\Http\Controllers\Admin;

use Pterodactyl\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Pterodactyl\Tests\Integration\Http\HttpTestCase;
use Pterodactyl\Tests\Integration\Api\Client\AccountProfileTest;

class BrandingControllerTest extends HttpTestCase
{
    public function setUp(): void
    {
        parent::setUp();

        defined('LARAVEL_START') || define('LARAVEL_START', microtime(true));

        Storage::fake('local');
    }

    public function testAdminCanUploadReplaceAndResetBranding(): void
    {
        $admin = User::factory()->admin()->create();

        foreach (['logo' => [512, 256], 'favicon' => [256, 256]] as $asset => [$maxWidth, $maxHeight]) {
            $this->actingAs($admin)
                ->post('/admin/settings/branding/' . $asset, [$asset => UploadedFile::fake()->createWithContent($asset . '.png', AccountProfileTest::pngBytes(1000, 1000))])
                ->assertRedirect(route('admin.settings.branding'));

            $stored = Storage::disk('local')->get('branding/' . $asset . '.png');
            [$width, $height] = getimagesizefromstring($stored);
            $this->assertLessThanOrEqual($maxWidth, $width);
            $this->assertLessThanOrEqual($maxHeight, $height);
            $this->assertSame($width, $height);

            // Settings are loaded when the application boots, so emulate the next request.
            $version = substr(sha1($stored), 0, 16);
            config(['pterodactyl.branding.' . $asset => $version]);
            $url = route('branding.' . $asset, ['v' => $version], false);
            $this->actingAs($admin)->get(route('admin.settings'))->assertOk()->assertSee($url, false);

            // Branding assets are public so that they can be shown on the login page.
            $this->app['auth']->forgetGuards();
            $this->get($url)
                ->assertOk()
                ->assertHeader('Content-Type', 'image/png')
                ->assertHeader('Cache-Control', 'immutable, max-age=31536000, public');

            $this->actingAs($admin)->delete('/admin/settings/branding/' . $asset)->assertRedirect(route('admin.settings.branding'));
            config(['pterodactyl.branding.' . $asset => null]);
            Storage::disk('local')->assertMissing('branding/' . $asset . '.png');
            $this->app['auth']->forgetGuards();
            $this->get(route('branding.' . $asset))->assertNotFound();
        }
    }

    public function testWideLogoKeepsAspectRatio(): void
    {
        $this->actingAs(User::factory()->admin()->create())
            ->post('/admin/settings/branding/logo', ['logo' => UploadedFile::fake()->createWithContent('logo.png', AccountProfileTest::pngBytes(1024, 128))])
            ->assertRedirect();

        $this->assertSame([512, 64], array_slice(getimagesizefromstring(Storage::disk('local')->get('branding/logo.png')), 0, 2));
    }

    public function testInvalidBrandingUploadsAreRejected(): void
    {
        $admin = User::factory()->admin()->create();
        $image = imagecreatetruecolor(8, 8);
        ob_start();
        imagejpeg($image);
        $jpeg = ob_get_clean();

        $invalid = [
            ['logo.jpg', $jpeg],
            ['logo.png', $jpeg],
            ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
            ['logo.png', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
            ['logo.png', AccountProfileTest::pngBytes() . str_repeat('0', 3 * 1024 * 1024)],
        ];

        foreach ($invalid as [$name, $contents]) {
            $this->actingAs($admin)
                ->from(route('admin.settings'))
                ->withHeaders(['Accept' => 'text/html'])
                ->post('/admin/settings/branding/logo', ['logo' => UploadedFile::fake()->createWithContent($name, $contents)])
                ->assertSessionHasErrors('logo');
        }

        $this->actingAs($admin)
            ->withHeaders(['Accept' => 'text/html'])
            ->post('/admin/settings/branding/favicon', ['favicon' => UploadedFile::fake()->createWithContent('f.png', AccountProfileTest::pngBytes() . str_repeat('0', 600 * 1024))])
            ->assertSessionHasErrors('favicon');

        $this->assertEmpty(Storage::disk('local')->allFiles());
    }

    public function testUnknownAssetIsNotFound(): void
    {
        $this->actingAs(User::factory()->admin()->create())
            ->post('/admin/settings/branding/..%2Fenv', ['x' => UploadedFile::fake()->createWithContent('a.png', AccountProfileTest::pngBytes())])
            ->assertNotFound();
    }

    public function testRegularUsersCannotModifyBranding(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->get(route('admin.settings'))->assertForbidden();
        $this->actingAs($user)
            ->post('/admin/settings/branding/logo', ['logo' => UploadedFile::fake()->createWithContent('logo.png', AccountProfileTest::pngBytes())])
            ->assertForbidden();
        $this->actingAs($user)->delete('/admin/settings/branding/logo')->assertForbidden();

        Storage::disk('local')->assertMissing('branding/logo.png');
    }
}
