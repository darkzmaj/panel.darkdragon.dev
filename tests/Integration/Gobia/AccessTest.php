<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\AccessTest;

use Illuminate\Support\Facades\Http;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Subuser;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class);

beforeEach(function (): void {
    // Changing access revokes the person's SFTP sessions on the node; nothing here should reach a real daemon.
    Http::fake();
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

function sharedWith(User $user, Server $server, array $permissions): void
{
    Subuser::query()->create(['user_id' => $user->id, 'server_id' => $server->id, 'permissions' => $permissions]);
}

const MANAGER = ['websocket.connect', 'user.create', 'user.read', 'user.update', 'user.delete', 'control.start', 'file.read'];

test('the people someone shares with see the server under Other, the owner under You and both under All', function (): void {
    $owner = User::factory()->create();
    $guest = User::factory()->create(['email' => 'seen@example.test']);
    $a = server($owner, 'Shared A');
    $this->actingAs($owner);
    $this->postJson(ACCESS, ['email' => 'seen@example.test', 'servers' => [$a->uuid], 'permissions' => ['websocket.connect', 'file.read']])->assertCreated();

    $names = fn (string $view): array => array_column($this->getJson('/api/client/extensions/gobia-core/servers?view='.$view)->assertOk()->json('data'), 'name');
    expect($names('you'))->toBe(['Shared A']);
    expect($names('all'))->toBe(['Shared A']);

    $this->actingAs($guest);
    expect($names('other'))->toBe(['Shared A']);
    expect($names('all'))->toBe(['Shared A']);
    expect($names('you'))->toBe([]);

    // Revoking removes it again, immediately.
    $this->actingAs($owner);
    $this->deleteJson(ACCESS.'/'.$guest->uuid)->assertOk();
    $this->actingAs($guest);
    expect($names('all'))->toBe([]);
});

test('an owner lists their servers as owned with nothing withheld', function (): void {
    $owner = User::factory()->create();
    server($owner, 'Mine');
    $this->actingAs($owner);

    $servers = $this->getJson(ACCESS)->assertOk()->json('servers');
    expect($servers)->toHaveCount(1);
    expect($servers[0]['owned'])->toBeTrue();
    expect($servers[0]['grantable'])->toBeNull();
});

test('someone given the whole user management set can share the server but only with permissions they hold', function (): void {
    $owner = User::factory()->create();
    $manager = User::factory()->create();
    $guest = User::factory()->create(['email' => 'new@example.test']);
    $a = server($owner, 'Delegated');
    sharedWith($manager, $a, MANAGER);
    $this->actingAs($manager);

    $servers = $this->getJson(ACCESS)->assertOk()->json('servers');
    expect(array_column($servers, 'name'))->toBe(['Delegated']);
    expect($servers[0]['owned'])->toBeFalse();
    expect($servers[0]['grantable'])->toEqualCanonicalizing(MANAGER);

    $this->postJson(ACCESS, ['email' => 'new@example.test', 'servers' => [$a->uuid], 'permissions' => ['websocket.connect', 'control.start']])->assertCreated();
    expect(Subuser::query()->where('user_id', $guest->id)->count())->toBe(1);

    // Escalation: a permission the manager does not hold cannot be given, on grant or on edit.
    $this->postJson(ACCESS, ['email' => 'new@example.test', 'servers' => [$a->uuid], 'permissions' => ['file.update']])->assertUnprocessable();
    $this->putJson(ACCESS.'/'.$guest->uuid, ['servers' => [$a->uuid], 'permissions' => ['control.start', 'backup.restore']])->assertUnprocessable();
    expect(Subuser::query()->where('user_id', $guest->id)->first()->permissions)->toBe(['websocket.connect', 'control.start']);

    // The manager does not appear in their own list and cannot be changed through it.
    expect(array_column($this->getJson(ACCESS)->json('grants'), 'email'))->toBe(['new@example.test']);
    $this->deleteJson(ACCESS.'/'.$manager->uuid)->assertNotFound();
});

test('a manager cannot change or remove someone who holds more than they do', function (): void {
    $owner = User::factory()->create();
    $manager = User::factory()->create();
    $power = User::factory()->create();
    $a = server($owner, 'Guarded');
    sharedWith($manager, $a, MANAGER);
    sharedWith($power, $a, ['websocket.connect', 'file.update', 'control.start']);
    $this->actingAs($manager);

    $this->putJson(ACCESS.'/'.$power->uuid, ['servers' => [$a->uuid], 'permissions' => ['control.start']])->assertForbidden();
    $this->deleteJson(ACCESS.'/'.$power->uuid)->assertForbidden();
    // Granting again to the same address rewrites permissions too, so it is refused the same way.
    $this->postJson(ACCESS, ['email' => $power->email, 'servers' => [$a->uuid], 'permissions' => ['control.start']])->assertForbidden();
    expect(Subuser::query()->where('user_id', $power->id)->first()->permissions)->toContain('file.update');
});

test('a partial user permission does not make someone a manager and an unrelated user manages nothing', function (): void {
    $owner = User::factory()->create();
    $reader = User::factory()->create();
    $other = User::factory()->create();
    $a = server($owner, 'Partial');
    sharedWith($reader, $a, ['websocket.connect', 'user.read']);

    $this->actingAs($reader);
    expect($this->getJson(ACCESS)->json('servers'))->toBe([]);
    $this->postJson(ACCESS, ['email' => $other->email, 'servers' => [$a->uuid], 'permissions' => ['websocket.connect']])->assertUnprocessable();

    $this->actingAs($other);
    expect($this->getJson(ACCESS)->json('servers'))->toBe([]);
    $this->postJson(ACCESS, ['email' => $reader->email, 'servers' => [$a->uuid], 'permissions' => ['websocket.connect']])->assertUnprocessable();
});

test('invalid input is refused with a message and already shared people are updated, not duplicated', function (): void {
    $owner = User::factory()->create(['email' => 'owner@example.test']);
    $a = server($owner, 'Input');
    $this->actingAs($owner);

    $this->postJson(ACCESS, ['email' => 'not-an-email', 'servers' => [$a->uuid], 'permissions' => ['websocket.connect']])->assertUnprocessable();
    $this->postJson(ACCESS, ['email' => 'x@example.test', 'servers' => [], 'permissions' => ['websocket.connect']])->assertUnprocessable();
    $this->postJson(ACCESS, ['email' => 'owner@example.test', 'servers' => [$a->uuid], 'permissions' => ['websocket.connect']])->assertUnprocessable();
    $this->postJson(ACCESS, ['email' => 'x@example.test', 'servers' => [$a->uuid], 'permissions' => ['made.up']])->assertUnprocessable();
});
