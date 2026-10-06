<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\AccessTest;

use Pterodactyl\Models\Server;
use Pterodactyl\Models\Subuser;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class);

beforeEach(function (): void {
    // Changing access revokes the person's SFTP sessions on the node; nothing here should reach a real daemon.
    \Illuminate\Support\Facades\Http::fake();
    $this->installGobia(['gobia-core']);
});
afterEach(fn () => $this->uninstallGobia());

const ACCESS = '/api/client/extensions/gobia-core/access';

function server(User $owner, string $name): Server
{
    return test()->createServerModel(['owner_id' => $owner->id, 'name' => $name]);
}

test('an owner grants one person access to several servers with chosen permissions', function (): void {
    $owner = User::factory()->create();
    $guest = User::factory()->create(['email' => 'friend@example.test']);
    $a = server($owner, 'A');
    $b = server($owner, 'B');
    $this->actingAs($owner);

    $this->postJson(ACCESS, ['email' => 'friend@example.test', 'servers' => [$a->uuid, $b->uuid], 'permissions' => ['control.console', 'file.read']])->assertCreated();

    $grants = $this->getJson(ACCESS)->assertOk()->json('grants');
    expect($grants)->toHaveCount(1);
    expect($grants[0]['email'])->toBe('friend@example.test');
    expect(array_column($grants[0]['servers'], 'name'))->toBe(['A', 'B']);
    expect($grants[0]['permissions'])->toBe(['control.console', 'file.read']);
    expect(Subuser::query()->where('user_id', $guest->id)->count())->toBe(2);
    expect($this->getJson(ACCESS)->json('servers'))->toHaveCount(2);
});

test('granting again updates instead of failing and permissions can be edited or removed', function (): void {
    $owner = User::factory()->create();
    $guest = User::factory()->create(['email' => 'g@example.test']);
    $a = server($owner, 'A');
    $b = server($owner, 'B');
    $this->actingAs($owner);
    $this->postJson(ACCESS, ['email' => 'g@example.test', 'servers' => [$a->uuid], 'permissions' => ['file.read']])->assertCreated();
    $this->postJson(ACCESS, ['email' => 'g@example.test', 'servers' => [$a->uuid], 'permissions' => ['file.read', 'file.create']])->assertCreated();
    expect(Subuser::query()->where('user_id', $guest->id)->count())->toBe(1);

    $this->putJson(ACCESS.'/'.$guest->uuid, ['servers' => [$b->uuid], 'permissions' => ['control.start']])->assertOk();
    $rows = Subuser::query()->where('user_id', $guest->id)->get();
    expect($rows)->toHaveCount(1);
    expect($rows->first()->server_id)->toBe($b->id);
    expect($rows->first()->permissions)->toBe(['control.start']);

    $this->deleteJson(ACCESS.'/'.$guest->uuid)->assertOk();
    expect(Subuser::query()->where('user_id', $guest->id)->count())->toBe(0);
    $this->deleteJson(ACCESS.'/'.$guest->uuid)->assertNotFound();
});

test('only servers the caller owns can be shared or changed', function (): void {
    $owner = User::factory()->create();
    $stranger = User::factory()->create();
    $guest = User::factory()->create(['email' => 'g@example.test']);
    $mine = server($owner, 'Mine');
    $theirs = server($stranger, 'Theirs');
    $this->actingAs($owner);

    $this->postJson(ACCESS, ['email' => 'g@example.test', 'servers' => [$theirs->uuid], 'permissions' => []])->assertUnprocessable();
    $this->postJson(ACCESS, ['email' => 'g@example.test', 'servers' => [$mine->uuid, $theirs->uuid], 'permissions' => []])->assertUnprocessable();
    expect(Subuser::query()->where('user_id', $guest->id)->count())->toBe(0);

    // A subuser of someone else's server cannot be used to reach it either.
    Subuser::factory()->create(['user_id' => $guest->id, 'server_id' => $theirs->id, 'permissions' => ['file.read']]);
    $this->putJson(ACCESS.'/'.$guest->uuid, ['servers' => [$mine->uuid], 'permissions' => []])->assertNotFound();
    $this->deleteJson(ACCESS.'/'.$guest->uuid)->assertNotFound();
    expect(Subuser::query()->where(['user_id' => $guest->id, 'server_id' => $theirs->id])->exists())->toBeTrue();

    $this->actingAs($stranger);
    expect($this->getJson(ACCESS)->json('grants'))->toHaveCount(1);
});

test('unknown permissions, bad input, the owner themself and anonymous callers are rejected', function (): void {
    $owner = User::factory()->create(['email' => 'owner@example.test']);
    $a = server($owner, 'A');
    $this->postJson(ACCESS, [])->assertUnauthorized();
    $this->actingAs($owner);

    $base = ['email' => 'x@example.test', 'servers' => [$a->uuid]];
    $this->postJson(ACCESS, $base + ['permissions' => ['root.everything']])->assertUnprocessable();
    $this->postJson(ACCESS, ['email' => 'not-an-email', 'servers' => [$a->uuid], 'permissions' => []])->assertUnprocessable();
    $this->postJson(ACCESS, ['email' => 'x@example.test', 'servers' => [], 'permissions' => []])->assertUnprocessable();
    $this->postJson(ACCESS, ['email' => 'x@example.test', 'servers' => ['nope'], 'permissions' => []])->assertUnprocessable();
    $this->postJson(ACCESS, ['email' => 'owner@example.test', 'servers' => [$a->uuid], 'permissions' => []])->assertUnprocessable();
    $this->postJson(ACCESS, $base)->assertUnprocessable();
});

test('granted people see the shared servers in their list and lose them on removal', function (): void {
    $owner = User::factory()->create();
    $guest = User::factory()->create(['email' => 'g@example.test']);
    $a = server($owner, 'Shared');
    $this->actingAs($owner)->postJson(ACCESS, ['email' => 'g@example.test', 'servers' => [$a->uuid], 'permissions' => ['websocket.connect']])->assertCreated();
    $list = '/api/client/extensions/gobia-core/servers?view=other';
    expect(array_column($this->actingAs($guest)->getJson($list)->json('data'), 'name'))->toBe(['Shared']);
    $this->actingAs($owner)->deleteJson(ACCESS.'/'.$guest->uuid)->assertOk();
    expect($this->actingAs($guest)->getJson($list)->json('data'))->toBe([]);
});
