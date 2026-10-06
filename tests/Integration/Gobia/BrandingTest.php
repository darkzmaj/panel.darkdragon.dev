<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\BrandingTest;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Pterodactyl\Models\User;
use Pterodactyl\Services\Extensions\ExtensionSettingsRegistry;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class);

beforeEach(function (): void {
    Storage::fake('local');
    $this->installGobia(['gobia-core']);
    $this->admin = User::factory()->create(['root_admin' => true]);
});
afterEach(fn () => $this->uninstallGobia());

function pngBytes(): string
{
    return base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', true);
}

function upload(string $bytes, string $name = 'logo.png'): UploadedFile
{
    return UploadedFile::fake()->createWithContent($name, $bytes);
}

function logoRoute(string $input): string
{
    return route('api.admin.extensions.settings.file', ['extension' => 'gobia-core', 'input' => $input]);
}

test('without uploads the Gobia logo and icon are the defaults', function (): void {
    $definition = app(ExtensionSettingsRegistry::class)->get('gobia-core');
    expect($definition->get('logo'))->toBe('/assets/theme/img/icon-256.png');
    expect($definition->get('favicon'))->toBe('/assets/theme/img/favicon-32.png');
});

test('an admin uploads a PNG, it is served under a random name and reset returns the default', function (): void {
    $this->actingAs($this->admin);
    $this->post(logoRoute('logo'), ['file' => upload(pngBytes(), 'evil.php')], ['Accept' => 'application/json'])->assertOk();
    $url = app(ExtensionSettingsRegistry::class)->get('gobia-core')->get('logo');
    expect($url)->toStartWith('/extension-files/gobia-core/')->toEndWith('.png');
    expect($url)->not->toContain('evil');
    $this->app['auth']->forgetGuards();
    $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/png');

    $this->actingAs($this->admin)->delete(logoRoute('logo'), [], ['Accept' => 'application/json'])->assertOk();
    expect(app(ExtensionSettingsRegistry::class)->get('gobia-core')->get('logo'))->toBe('/assets/theme/img/icon-256.png');
    expect(Storage::disk('local')->allFiles())->toBe([]);
});

test('only PNG content is accepted whatever the name says', function (): void {
    $this->actingAs($this->admin);
    $headers = ['Accept' => 'application/json'];
    $this->post(logoRoute('logo'), ['file' => upload('<?php echo 1;', 'logo.png')], $headers)->assertUnprocessable();
    $this->post(logoRoute('logo'), ['file' => upload('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'logo.png')], $headers)->assertUnprocessable();
    $this->post(logoRoute('logo'), ['file' => upload("\xFF\xD8\xFF\xE0".str_repeat('a', 100), 'logo.png')], $headers)->assertUnprocessable();
    $this->post(logoRoute('logo'), ['file' => upload(pngBytes().str_repeat("\0", 2 * 1024 * 1024))], $headers)->assertUnprocessable();
    $this->post(logoRoute('favicon'), ['file' => upload(pngBytes().str_repeat("\0", 300 * 1024))], $headers)->assertUnprocessable();
    expect(Storage::disk('local')->allFiles())->toBe([]);
});

test('only administrators can change branding', function (): void {
    $this->actingAs(User::factory()->create());
    $this->post(logoRoute('logo'), ['file' => upload(pngBytes())], ['Accept' => 'application/json'])->assertForbidden();
});

test('the page head carries the configured favicon', function (): void {
    $html = $this->get('/auth/login')->assertOk()->getContent();
    expect($html)->toContain('/assets/theme/img/favicon-32.png');
});
