<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\ProfileAppearanceTest;

use Illuminate\Support\Facades\Schema;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class);

beforeEach(fn () => $this->installGobia(['gobia-core']));
afterEach(fn () => $this->uninstallGobia());

const PROFILE = '/api/client/extensions/gobia-core/profile';

test('the extension owns its profile table and leaves the users table alone', function (): void {
    expect(Schema::hasTable('gobia_user_profiles'))->toBeTrue();
    expect(Schema::hasColumn('users', 'avatar_hash'))->toBeFalse();
    expect(Schema::hasColumn('users', 'theme'))->toBeFalse();
});

test('the profile defaults to the system scheme and requires authentication', function (): void {
    $this->getJson(PROFILE)->assertUnauthorized();
    $this->actingAs(User::factory()->create())->getJson(PROFILE)->assertOk()->assertJsonPath('theme', 'system');
});

test('a user can choose a scheme and it is private to them', function (): void {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $this->actingAs($a)->putJson(PROFILE.'/appearance', ['theme' => 'dark'])->assertOk()->assertJsonPath('theme', 'dark');
    $this->actingAs($a)->getJson(PROFILE)->assertJsonPath('theme', 'dark');
    $this->actingAs($b)->getJson(PROFILE)->assertJsonPath('theme', 'system');
});

test('invalid schemes are rejected', function (): void {
    $user = User::factory()->create();
    foreach (['purple', '', null, ['dark']] as $value) {
        $this->actingAs($user)->putJson(PROFILE.'/appearance', ['theme' => $value])->assertUnprocessable();
    }
    $this->actingAs($user)->getJson(PROFILE)->assertJsonPath('theme', 'system');
});

test('deleting a user removes their profile row', function (): void {
    $user = User::factory()->create();
    $this->actingAs($user)->putJson(PROFILE.'/appearance', ['theme' => 'light'])->assertOk();
    $user->delete();
    expect(\Illuminate\Support\Facades\DB::table('gobia_user_profiles')->where('user_id', $user->id)->exists())->toBeFalse();
});
