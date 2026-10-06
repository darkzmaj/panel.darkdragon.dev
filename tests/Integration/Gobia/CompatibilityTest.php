<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\CompatibilityTest;

use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class);

const COMPAT = '/api/admin/extensions/gobia-core/compatibility';

beforeEach(fn () => $this->installGobia(['gobia-core']));
afterEach(fn () => $this->uninstallGobia());

test('the report is admin only', function (): void {
    $this->getJson(COMPAT)->assertUnauthorized();
    $this->actingAs(User::factory()->create())->getJson(COMPAT)->assertForbidden();
});

test('the report names Gobia, the pinned Pterodactyl base, extensions, migrations and health', function (): void {
    $report = $this->actingAs(User::factory()->create(['root_admin' => true]))->getJson(COMPAT)->assertOk()->json();
    $release = json_decode((string) file_get_contents(base_path('gobia-release.json')), true);

    expect($report['gobia_version'])->toBe($release['gobia_version']);
    expect($report['pterodactyl_base']['commit'])->toBe($release['pterodactyl_base']['commit'])->toMatch('/^[0-9a-f]{40}$/');
    expect($report['php'])->toBe(PHP_VERSION);
    expect($report['database']['driver'])->toBe('mysql');
    expect($report['health'])->toMatchArray(['database' => true, 'cache' => true]);
    expect($report['migrations']['pending'])->toBeInt();

    $core = collect($report['extensions'])->firstWhere('id', 'gobia-core');
    expect($core)->not->toBeNull();
    expect($core['enabled'])->toBeTrue();
    expect($core['compatible'])->toBeTrue();
    expect($core['requires'])->toHaveKeys(['panel', 'sdk', 'php']);
});

test('the release file never contains secrets', function (): void {
    $text = (string) file_get_contents(base_path('gobia-release.json'));
    expect($text)->not->toMatch('/(password|secret|token|private[_ ]?key)/i');
});
