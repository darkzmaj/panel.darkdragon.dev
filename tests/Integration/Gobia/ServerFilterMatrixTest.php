<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\ServerFilterMatrixTest;

use Illuminate\Testing\TestResponse;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Subuser;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class);

beforeEach(fn () => $this->installGobia(['gobia-core']));
afterEach(fn () => $this->uninstallGobia());

const BASE = '/api/client/extensions/gobia-core';

function server(User $owner, string $name, string $description = ''): Server
{
    return test()->createServerModel(['owner_id' => $owner->id, 'name' => $name, 'description' => $description]);
}

function listed(TestResponse $response): array
{
    return array_column($response->json('data'), 'name');
}

/**
 * Two categories and a mix of owned and shared servers:
 *   Hubs:   Hub Alpha (mine), Hub Beta (shared)
 *   Games:  Game Beta (mine)
 *   none:   Spare (mine), Lobby Beta (shared)
 */
function matrix(): array
{
    $me = User::factory()->create();
    $other = User::factory()->create();
    $servers = [
        'hubAlpha' => server($me, 'Hub Alpha', 'primary hub'),
        'hubBeta' => server($other, 'Hub Beta'),
        'gameBeta' => server($me, 'Game Beta'),
        'spare' => server($me, 'Spare'),
        'lobbyBeta' => server($other, 'Lobby Beta'),
    ];
    foreach (['hubBeta', 'lobbyBeta'] as $key) {
        Subuser::factory()->create(['user_id' => $me->id, 'server_id' => $servers[$key]->id, 'permissions' => ['websocket.connect']]);
    }
    test()->actingAs($me);
    $hubs = test()->postJson(BASE.'/categories', ['name' => 'Hubs'])->json('id');
    $games = test()->postJson(BASE.'/categories', ['name' => 'Games'])->json('id');
    test()->putJson(BASE."/categories/$hubs/servers", ['servers' => [$servers['hubAlpha']->uuid, $servers['hubBeta']->uuid]])->assertOk();
    test()->putJson(BASE."/categories/$games/servers", ['servers' => [$servers['gameBeta']->uuid]])->assertOk();

    return [$hubs, $games];
}

it('keeps ownership and category filters composable', function (string $query, array $expected): void {
    [$hubs, $games] = matrix();
    $query = str_replace(['{hubs}', '{games}'], [(string) $hubs, (string) $games], $query);

    expect(listed($this->getJson(BASE.'/servers?'.$query)->assertOk()))->toEqualCanonicalizing($expected);
})->with([
    'all, no category' => ['view=all', ['Hub Alpha', 'Hub Beta', 'Game Beta', 'Spare', 'Lobby Beta']],
    'you, no category' => ['view=you', ['Hub Alpha', 'Game Beta', 'Spare']],
    'other, no category' => ['view=other', ['Hub Beta', 'Lobby Beta']],
    'all in Hubs' => ['view=all&category={hubs}', ['Hub Alpha', 'Hub Beta']],
    'you in Hubs' => ['view=you&category={hubs}', ['Hub Alpha']],
    'other in Hubs' => ['view=other&category={hubs}', ['Hub Beta']],
    'you in Games' => ['view=you&category={games}', ['Game Beta']],
    'other in Games' => ['view=other&category={games}', []],
    'all in no category' => ['view=all&category=none', ['Spare', 'Lobby Beta']],
    'other in no category' => ['view=other&category=none', ['Lobby Beta']],
    'search beta, all' => ['view=all&q=beta', ['Hub Beta', 'Game Beta', 'Lobby Beta']],
    'search beta, you' => ['view=you&q=beta', ['Game Beta']],
    'search beta, other' => ['view=other&q=beta', ['Hub Beta', 'Lobby Beta']],
    'search beta in Hubs, you' => ['view=you&category={hubs}&q=beta', []],
    'search beta in Hubs, other' => ['view=other&category={hubs}&q=beta', ['Hub Beta']],
    'search by description' => ['view=all&q=primary', ['Hub Alpha']],
]);

it('reports the true row count of every view for the current category and search', function (): void {
    [$hubs] = matrix();

    $everything = $this->getJson(BASE.'/servers')->json('meta.counts');
    expect($everything)->toBe(['all' => 5, 'you' => 3, 'other' => 2]);

    $inHubs = $this->getJson(BASE."/servers?category=$hubs")->json('meta.counts');
    expect($inHubs)->toBe(['all' => 2, 'you' => 1, 'other' => 1]);

    $searched = $this->getJson(BASE.'/servers?q=beta')->json('meta.counts');
    expect($searched)->toBe(['all' => 3, 'you' => 1, 'other' => 2]);

    // The counts do not depend on which view is being listed.
    expect($this->getJson(BASE.'/servers?view=you&category='.$hubs)->json('meta.counts'))->toBe($inHubs);
});

it('stops listing a deleted category and falls back to every server', function (): void {
    [$hubs] = matrix();
    $this->deleteJson(BASE."/categories/$hubs")->assertOk();

    expect(listed($this->getJson(BASE."/servers?category=$hubs")))->toBe([]);
    expect(listed($this->getJson(BASE.'/servers')))->toHaveCount(5);
    expect($this->getJson(BASE.'/servers/summary')->json('categories'))->toHaveCount(1);
});
