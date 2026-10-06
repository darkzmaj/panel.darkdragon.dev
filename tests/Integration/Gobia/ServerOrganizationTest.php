<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\ServerOrganizationTest;

use Illuminate\Support\Facades\DB;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Subuser;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class);

beforeEach(fn () => $this->installGobia(['gobia-core']));
afterEach(fn () => $this->uninstallGobia());

const BASE = '/api/client/extensions/gobia-core';

function ownedBy(User $user, string $name): Server
{
    return test()->createServerModel(['owner_id' => $user->id, 'name' => $name]);
}

function sharedWith(User $user, Server $server): void
{
    Subuser::factory()->create(['user_id' => $user->id, 'server_id' => $server->id, 'permissions' => ['websocket.connect']]);
}

function names(\Illuminate\Testing\TestResponse $response): array
{
    return array_column($response->json('data'), 'name');
}

test('all, you and other show exactly the servers a user can open', function (): void {
    $me = User::factory()->create();
    $other = User::factory()->create();
    ownedBy($me, 'Mine A');
    ownedBy($me, 'Mine B');
    sharedWith($me, ownedBy($other, 'Shared Hub'));
    ownedBy($other, 'Private to someone else');
    $this->actingAs($me);

    expect(names($this->getJson(BASE.'/servers')->assertOk()))->toBe(['Mine A', 'Mine B', 'Shared Hub']);
    expect(names($this->getJson(BASE.'/servers?view=you')))->toBe(['Mine A', 'Mine B']);
    expect(names($this->getJson(BASE.'/servers?view=other')))->toBe(['Shared Hub']);
    $summary = $this->getJson(BASE.'/servers/summary')->assertOk()->json();
    expect($summary['counts'])->toBe(['all' => 3, 'you' => 2, 'other' => 1]);
    expect($this->getJson(BASE.'/servers?view=bogus')->status())->toBe(422);
});

test('an administrator does not see servers they cannot open as theirs', function (): void {
    $admin = User::factory()->create(['root_admin' => true]);
    ownedBy(User::factory()->create(), 'Someone elses');
    ownedBy($admin, 'Admin owned');
    expect(names($this->actingAs($admin)->getJson(BASE.'/servers')))->toBe(['Admin owned']);
});

test('search matches the name, the identifier and the address and escapes wildcards', function (): void {
    $me = User::factory()->create();
    $first = ownedBy($me, 'Survival World');
    ownedBy($me, 'Creative 100%');
    $this->actingAs($me);

    expect(names($this->getJson(BASE.'/servers?q=surv')))->toBe(['Survival World']);
    expect(names($this->getJson(BASE.'/servers?q='.substr($first->uuid, 0, 8))))->toBe(['Survival World']);
    expect(names($this->getJson(BASE.'/servers?q=100%25')))->toBe(['Creative 100%']);
    expect(names($this->getJson(BASE.'/servers?q=%25')))->toBe(['Creative 100%']);
    expect(names($this->getJson(BASE.'/servers?q=zzz')))->toBe([]);
});

test('pagination is stable, bounded and counts what was filtered', function (): void {
    $me = User::factory()->create();
    foreach (range(1, 35) as $i) {
        ownedBy($me, sprintf('Server %02d', $i));
    }
    $this->actingAs($me);

    $first = $this->getJson(BASE.'/servers?per_page=20')->assertOk();
    expect($first->json('meta.pagination'))->toMatchArray(['total' => 35, 'per_page' => 20, 'current_page' => 1, 'total_pages' => 2]);
    expect(names($this->getJson(BASE.'/servers?per_page=20&page=2')))->toHaveCount(15);
    $this->getJson(BASE.'/servers?per_page=500')->assertUnprocessable();
    $this->getJson(BASE.'/servers?page=0')->assertUnprocessable();
});

test('the list uses a fixed number of queries however many servers there are', function (): void {
    $me = User::factory()->create();
    foreach (range(1, 25) as $i) {
        ownedBy($me, "Q$i");
    }
    $this->actingAs($me);
    $this->getJson(BASE.'/servers')->assertOk(); // warm caches
    DB::flushQueryLog();
    DB::enableQueryLog();
    $this->getJson(BASE.'/servers?per_page=25')->assertOk();
    $count = count(DB::getQueryLog());
    DB::disableQueryLog();
    expect($count)->toBeLessThanOrEqual(8);
});

test('categories are created, renamed, unique per user, limited and deleted without touching servers', function (): void {
    $me = User::factory()->create();
    $server = ownedBy($me, 'Keep me');
    $this->actingAs($me);

    $id = $this->postJson(BASE.'/categories', ['name' => 'Minecraft'])->assertCreated()->json('id');
    $this->postJson(BASE.'/categories', ['name' => 'Minecraft'])->assertUnprocessable();
    $this->postJson(BASE.'/categories', ['name' => ''])->assertUnprocessable();
    $this->postJson(BASE.'/categories', ['name' => str_repeat('x', 33)])->assertUnprocessable();
    $this->putJson(BASE."/categories/$id", ['name' => 'Games'])->assertOk();
    expect($this->getJson(BASE.'/servers/summary')->json('categories.0.name'))->toBe('Games');
    $this->putJson(BASE."/categories/$id/servers", ['servers' => [$server->uuid]])->assertOk();
    expect(names($this->getJson(BASE."/servers?category=$id")))->toBe(['Keep me']);
    expect($this->getJson(BASE.'/servers?category=none')->json('data'))->toBe([]);

    $this->deleteJson(BASE."/categories/$id")->assertOk();
    expect(Server::query()->whereKey($server->id)->exists())->toBeTrue();
    expect(names($this->getJson(BASE.'/servers?category=none')))->toBe(['Keep me']);

    foreach (range(1, 24) as $i) {
        $this->postJson(BASE.'/categories', ['name' => "Cat $i"])->assertCreated();
    }
    $this->postJson(BASE.'/categories', ['name' => 'One too many'])->assertUnprocessable();
});

test('categories and their membership are private and cannot be used to reach other people\'s servers', function (): void {
    $me = User::factory()->create();
    $attacker = User::factory()->create();
    $mine = ownedBy($me, 'Mine');
    $theirs = ownedBy($attacker, 'Theirs');
    $myCategory = $this->actingAs($me)->postJson(BASE.'/categories', ['name' => 'Private'])->json('id');
    $this->putJson(BASE."/categories/$myCategory/servers", ['servers' => [$mine->uuid]])->assertOk();

    $this->actingAs($attacker);
    $this->putJson(BASE."/categories/$myCategory", ['name' => 'Hijack'])->assertNotFound();
    $this->deleteJson(BASE."/categories/$myCategory")->assertNotFound();
    $this->putJson(BASE."/categories/$myCategory/servers", ['servers' => [$theirs->uuid]])->assertNotFound();
    expect($this->getJson(BASE.'/servers/summary')->json('categories'))->toBe([]);
    expect($this->getJson(BASE."/servers?category=$myCategory")->json('data'))->toBe([]);

    $attackerCategory = $this->postJson(BASE.'/categories', ['name' => 'Mine too'])->json('id');
    $this->putJson(BASE."/categories/$attackerCategory/servers", ['servers' => [$mine->uuid]])->assertUnprocessable();
    $this->putJson(BASE."/categories/$attackerCategory/servers/{$mine->uuid}", ['member' => true])->assertUnprocessable();
    expect(DB::table('gobia_server_category_members')->where('server_id', $mine->id)->count())->toBe(1);
});

test('losing access removes a server from the list and the counts', function (): void {
    $me = User::factory()->create();
    $owner = User::factory()->create();
    $shared = ownedBy($owner, 'Shared');
    sharedWith($me, $shared);
    $this->actingAs($me);
    $category = $this->postJson(BASE.'/categories', ['name' => 'Work'])->json('id');
    $this->putJson(BASE."/categories/$category/servers", ['servers' => [$shared->uuid]])->assertOk();
    expect($this->getJson(BASE.'/servers/summary')->json('categories.0.count'))->toBe(1);

    Subuser::query()->where(['user_id' => $me->id, 'server_id' => $shared->id])->delete();
    expect($this->getJson(BASE.'/servers')->json('data'))->toBe([]);
    $summary = $this->getJson(BASE.'/servers/summary')->json();
    expect($summary['categories'][0]['count'])->toBe(0);
    expect($summary['counts']['all'])->toBe(0);
    expect(names($this->getJson(BASE."/servers?category=$category")))->toBe([]);
});

test('a personal order persists, only moves the listed servers and is private', function (): void {
    $me = User::factory()->create();
    $other = User::factory()->create();
    $a = ownedBy($me, 'A');
    $b = ownedBy($me, 'B');
    $c = ownedBy($me, 'C');
    $d = ownedBy($me, 'D');
    sharedWith($other, $a);
    $this->actingAs($me);
    expect(names($this->getJson(BASE.'/servers')))->toBe(['A', 'B', 'C', 'D']);

    $this->putJson(BASE.'/servers/order', ['servers' => [$c->uuid, $a->uuid]])->assertOk();
    expect(names($this->getJson(BASE.'/servers')))->toBe(['C', 'B', 'A', 'D']);
    $this->putJson(BASE.'/servers/order', ['servers' => [$d->uuid, $b->uuid, $c->uuid, $a->uuid]])->assertOk();
    expect(names($this->getJson(BASE.'/servers')))->toBe(['D', 'B', 'C', 'A']);
    expect(names($this->actingAs($other)->getJson(BASE.'/servers')))->toBe(['A']);

    $this->actingAs($me)->putJson(BASE.'/servers/order', ['servers' => [$a->uuid, ownedBy($other, 'Not mine')->uuid]])->assertUnprocessable();
    $this->putJson(BASE.'/servers/order', ['servers' => []])->assertUnprocessable();
    $this->putJson(BASE.'/servers/order', ['servers' => ['not-a-uuid']])->assertUnprocessable();
    expect(names($this->getJson(BASE.'/servers')))->toBe(['D', 'B', 'C', 'A']);
});

test('servers keep their order inside a category and categories can be reordered', function (): void {
    $me = User::factory()->create();
    $servers = collect(['One', 'Two', 'Three'])->map(fn (string $name): Server => ownedBy($me, $name));
    $this->actingAs($me);
    $first = $this->postJson(BASE.'/categories', ['name' => 'First'])->json('id');
    $second = $this->postJson(BASE.'/categories', ['name' => 'Second'])->json('id');
    $this->putJson(BASE."/categories/$first/servers", ['servers' => $servers->pluck('uuid')->all()])->assertOk();
    $this->putJson(BASE.'/servers/order', ['category' => $first, 'servers' => [$servers[2]->uuid, $servers[0]->uuid, $servers[1]->uuid]])->assertOk();
    expect(names($this->getJson(BASE."/servers?category=$first")))->toBe(['Three', 'One', 'Two']);
    expect(names($this->getJson(BASE.'/servers')))->toBe(['One', 'Three', 'Two']);
    $this->putJson(BASE.'/servers/order', ['category' => $second, 'servers' => [$servers[0]->uuid]])->assertUnprocessable();

    $this->putJson(BASE.'/categories/order', ['categories' => [$second, $first]])->assertOk();
    expect(array_column($this->getJson(BASE.'/servers/summary')->json('categories'), 'name'))->toBe(['Second', 'First']);
    $this->putJson(BASE.'/categories/order', ['categories' => [$second]])->assertUnprocessable();
    $this->putJson(BASE.'/categories/order', ['categories' => [$second, $second]])->assertUnprocessable();
});

test('icon colours are per user, validated, cleared on request and remembered five at a time', function (): void {
    $me = User::factory()->create();
    $other = User::factory()->create();
    $server = ownedBy($me, 'Painted');
    sharedWith($other, $server);
    $this->actingAs($me);

    foreach (['#112233', '#445566', '#778899', '#AABBCC', '#112233', '#ddeeff', '#010203'] as $color) {
        $this->putJson(BASE."/servers/{$server->uuid}/icon-color", ['color' => $color])->assertOk();
    }
    $recent = $this->getJson(BASE.'/servers/summary')->json('recent_icon_colors');
    expect($recent)->toBe(['#010203', '#ddeeff', '#112233', '#aabbcc', '#778899']);
    expect($this->getJson(BASE.'/servers')->json('data.0.icon_color'))->toBe('#010203');
    expect($this->actingAs($other)->getJson(BASE.'/servers')->json('data.0.icon_color'))->toBeNull();

    $this->actingAs($me);
    foreach (['red', '#12345', '#1234567', 'url(x)', '#12345g', 5] as $invalid) {
        $this->putJson(BASE."/servers/{$server->uuid}/icon-color", ['color' => $invalid])->assertUnprocessable();
    }
    $this->putJson(BASE."/servers/{$server->uuid}/icon-color", ['color' => null])->assertOk()->assertJsonPath('icon_color', null);
    expect($this->getJson(BASE.'/servers')->json('data.0.icon_color'))->toBeNull();
    $this->putJson(BASE."/servers/{$server->uuid}/icon-color", [])->assertUnprocessable();
});

test('icon colours cannot be set on servers the user cannot open', function (): void {
    $me = User::factory()->create();
    $foreign = ownedBy(User::factory()->create(), 'Foreign');
    $this->actingAs($me)->putJson(BASE."/servers/{$foreign->uuid}/icon-color", ['color' => '#112233'])->assertUnprocessable();
    expect(DB::table('gobia_server_preferences')->where('server_id', $foreign->id)->exists())->toBeFalse();
    $this->putJson(BASE.'/servers/not-a-uuid/icon-color', ['color' => '#112233'])->assertNotFound();
});

test('every endpoint requires authentication', function (): void {
    foreach ([['getJson', '/servers'], ['getJson', '/servers/summary'], ['putJson', '/servers/order'], ['postJson', '/categories'], ['putJson', '/categories/order']] as [$method, $path]) {
        $this->{$method}(BASE.$path)->assertUnauthorized();
    }
});
