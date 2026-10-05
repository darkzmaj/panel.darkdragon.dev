<?php

namespace Pterodactyl\Tests\Integration\Api\Client;

use Pterodactyl\Models\User;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Subuser;
use Illuminate\Support\Facades\DB;

class ServerLayoutTest extends ClientApiIntegrationTestCase
{
    private User $user;

    /** @var Server[] */
    private array $servers = [];

    public function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
        foreach (['Alpha', 'Bravo', 'Charlie', 'Delta'] as $name) {
            $this->servers[$name] = $this->createServerModel(['user_id' => $this->user->id, 'name' => $name]);
        }
    }

    private function uuids(string ...$names): array
    {
        return array_map(fn ($name) => $this->servers[$name]->uuid, $names);
    }

    private function listed(User $user, string $query = ''): array
    {
        return collect($this->actingAs($user)->getJson('/api/client' . $query)->assertOk()->json('data'))
            ->map(fn ($row) => $row['attributes']['name'])
            ->all();
    }

    public function testDefaultOrderIsAlphabeticalUntilTheUserArrangesThem(): void
    {
        $this->assertSame(['Alpha', 'Bravo', 'Charlie', 'Delta'], $this->listed($this->user));
    }

    public function testReorderingPersistsForTheUserAndAcrossRequests(): void
    {
        $this->actingAs($this->user)->putJson('/api/client/account/layout/order', ['servers' => $this->uuids('Delta', 'Charlie', 'Bravo', 'Alpha')])->assertOk();

        $this->assertSame(['Delta', 'Charlie', 'Bravo', 'Alpha'], $this->listed($this->user));
        // A fresh request, as after logging in elsewhere, sees the same order from the database.
        $this->app['auth']->forgetGuards();
        $this->assertSame(['Delta', 'Charlie', 'Bravo', 'Alpha'], $this->listed($this->user));
        $this->assertSame(['Delta', 'Charlie', 'Bravo', 'Alpha'], array_map(fn ($uuid) => collect($this->servers)->firstWhere('uuid', $uuid)->name, $this->actingAs($this->user)->getJson('/api/client/account/layout')->json('order')));
    }

    public function testOrderIsPerUser(): void
    {
        $other = User::factory()->create();
        Subuser::query()->create(['user_id' => $other->id, 'server_id' => $this->servers['Alpha']->id, 'permissions' => ['websocket.connect']]);
        Subuser::query()->create(['user_id' => $other->id, 'server_id' => $this->servers['Bravo']->id, 'permissions' => ['websocket.connect']]);

        $this->actingAs($this->user)->putJson('/api/client/account/layout/order', ['servers' => $this->uuids('Delta', 'Charlie', 'Bravo', 'Alpha')])->assertOk();
        $this->actingAs($other)->putJson('/api/client/account/layout/order', ['servers' => $this->uuids('Bravo', 'Alpha')])->assertOk();

        $this->assertSame(['Bravo', 'Alpha'], $this->listed($other));
        $this->assertSame(['Delta', 'Charlie', 'Bravo', 'Alpha'], $this->listed($this->user));
    }

    public function testReorderingASubsetKeepsTheRestInPlace(): void
    {
        $this->actingAs($this->user)->putJson('/api/client/account/layout/order', ['servers' => $this->uuids('Charlie', 'Alpha')])->assertOk();

        // Alpha and Charlie swap places; Bravo and Delta stay where they were.
        $this->assertSame(['Charlie', 'Bravo', 'Alpha', 'Delta'], $this->listed($this->user));
    }

    public function testServersTheUserCannotAccessAreRejected(): void
    {
        $foreign = $this->createServerModel();

        $this->actingAs($this->user)->putJson('/api/client/account/layout/order', ['servers' => array_merge($this->uuids('Alpha'), [$foreign->uuid])])->assertStatus(400);
        $this->actingAs($this->user)->postJson('/api/client/account/layout/categories', ['name' => 'Mine', 'servers' => [$foreign->uuid]])->assertStatus(400);
        $this->assertDatabaseMissing('user_server_categories', ['name' => 'Mine']);
        $this->assertDatabaseMissing('user_server_preferences', ['server_id' => $foreign->id]);
    }

    public function testCategoriesCanBeCreatedRenamedFilteredAndDeleted(): void
    {
        $created = $this->actingAs($this->user)->postJson('/api/client/account/layout/categories', ['name' => 'Hubs', 'servers' => $this->uuids('Charlie', 'Alpha')])->assertCreated();
        $id = $created->json('categories.0.id');
        $this->assertSame($this->uuids('Charlie', 'Alpha'), $created->json('categories.0.servers'));

        $this->assertSame(['Charlie', 'Alpha'], $this->listed($this->user, '?category=' . $id), 'the category view uses the category order');
        $this->assertSame(['Alpha', 'Bravo', 'Charlie', 'Delta'], $this->listed($this->user));

        $this->actingAs($this->user)->putJson("/api/client/account/layout/categories/$id", ['name' => 'Lobbies', 'servers' => $this->uuids('Bravo')])->assertOk()
            ->assertJsonPath('categories.0.name', 'Lobbies')->assertJsonPath('categories.0.servers', $this->uuids('Bravo'));
        $this->assertSame(['Bravo'], $this->listed($this->user, '?category=' . $id));

        $this->actingAs($this->user)->putJson("/api/client/account/layout/categories/$id/order", ['servers' => $this->uuids('Bravo')])->assertOk();

        $this->actingAs($this->user)->deleteJson("/api/client/account/layout/categories/$id")->assertNoContent();
        $this->assertDatabaseMissing('user_server_categories', ['id' => $id]);
        $this->assertDatabaseMissing('user_server_category_members', ['category_id' => $id]);
    }

    public function testCategoryNamesAreUniquePerUserAndLimited(): void
    {
        $this->actingAs($this->user)->postJson('/api/client/account/layout/categories', ['name' => 'Hubs'])->assertCreated();
        $this->actingAs($this->user)->postJson('/api/client/account/layout/categories', ['name' => 'Hubs'])->assertStatus(400);
        $this->actingAs($this->user)->postJson('/api/client/account/layout/categories', ['name' => str_repeat('x', 33)])->assertUnprocessable();
        $this->actingAs($this->user)->postJson('/api/client/account/layout/categories', ['name' => ''])->assertUnprocessable();

        // Another user may reuse the name.
        $this->actingAs(User::factory()->create())->postJson('/api/client/account/layout/categories', ['name' => 'Hubs'])->assertCreated();
    }

    public function testCategoriesBelongToOneUser(): void
    {
        $id = $this->actingAs($this->user)->postJson('/api/client/account/layout/categories', ['name' => 'Private'])->json('categories.0.id');
        $other = User::factory()->create();

        $this->actingAs($other)->putJson("/api/client/account/layout/categories/$id", ['name' => 'Stolen'])->assertNotFound();
        $this->actingAs($other)->deleteJson("/api/client/account/layout/categories/$id")->assertNotFound();
        $this->actingAs($other)->getJson('/api/client?category=' . $id)->assertNotFound();
        $this->actingAs($other)->getJson('/api/client/account/layout')->assertJsonPath('categories', []);
        $this->assertDatabaseHas('user_server_categories', ['id' => $id, 'name' => 'Private']);
    }

    public function testLosingAccessImmediatelyHidesTheServerEverywhere(): void
    {
        $friend = User::factory()->create();
        $subuser = Subuser::query()->create(['user_id' => $friend->id, 'server_id' => $this->servers['Alpha']->id, 'permissions' => ['websocket.connect']]);
        $id = $this->actingAs($friend)->postJson('/api/client/account/layout/categories', ['name' => 'Shared', 'servers' => $this->uuids('Alpha')])->json('categories.0.id');
        $this->actingAs($friend)->putJson('/api/client/account/layout/order', ['servers' => $this->uuids('Alpha')])->assertOk();
        $this->assertSame(['Alpha'], $this->listed($friend, '?category=' . $id));

        $subuser->delete();

        $this->assertSame([], $this->listed($friend));
        $this->assertSame([], $this->listed($friend, '?category=' . $id));
        $layout = $this->actingAs($friend)->getJson('/api/client/account/layout')->assertOk();
        $layout->assertJsonPath('servers', [])->assertJsonPath('order', [])->assertJsonPath('categories.0.servers', []);
        // The stale rows are inert: they are not exposed, and the server cannot be re-added without access.
        $this->actingAs($friend)->putJson("/api/client/account/layout/categories/$id", ['name' => 'Shared', 'servers' => $this->uuids('Alpha')])->assertStatus(400);
    }

    public function testYouFilterListsOnlyOwnedServers(): void
    {
        $other = $this->createServerModel(['name' => 'Zulu']);
        Subuser::query()->create(['user_id' => $this->user->id, 'server_id' => $other->id, 'permissions' => ['websocket.connect']]);

        $this->assertContains('Zulu', $this->listed($this->user));
        $this->assertNotContains('Zulu', $this->listed($this->user, '?type=owner'));
        $this->assertCount(4, $this->listed($this->user, '?type=owner'));
    }

    public function testOtherFilterListsOnlyServersSharedWithTheUser(): void
    {
        $shared = $this->createServerModel(['name' => 'Zulu']);
        Subuser::query()->create(['user_id' => $this->user->id, 'server_id' => $shared->id, 'permissions' => ['websocket.connect']]);
        // Owned by someone else and not shared: never visible in any view.
        $this->createServerModel(['name' => 'Hidden']);

        $this->assertSame(['Zulu'], $this->listed($this->user, '?type=other'));
        $this->assertNotContains('Zulu', $this->listed($this->user, '?type=owner'));
        $this->assertNotContains('Hidden', $this->listed($this->user));
        $this->assertContains('Zulu', $this->listed($this->user));
    }

    public function testCategoryButtonsCanBeReorderedButOnlyOwnCategories(): void
    {
        $a = $this->actingAs($this->user)->postJson('/api/client/account/layout/categories', ['name' => 'A'])->json('categories.0.id');
        $b = $this->actingAs($this->user)->postJson('/api/client/account/layout/categories', ['name' => 'B'])->json('categories.1.id');
        $foreign = $this->actingAs(User::factory()->create())->postJson('/api/client/account/layout/categories', ['name' => 'Theirs'])->json('categories.0.id');

        $this->actingAs($this->user)->putJson('/api/client/account/layout/categories/order', ['categories' => [$b, $a]])->assertOk();
        $this->actingAs($this->user)->getJson('/api/client/account/layout')
            ->assertJsonPath('categories.0.id', $b)->assertJsonPath('categories.1.id', $a);

        // Another user's category id must neither be accepted nor change anything.
        $this->actingAs($this->user)->putJson('/api/client/account/layout/categories/order', ['categories' => [$foreign, $a, $b]])->assertStatus(400);
        $this->actingAs($this->user)->putJson('/api/client/account/layout/categories/order', ['categories' => 'nope'])->assertUnprocessable();
        $this->actingAs($this->user)->getJson('/api/client/account/layout')->assertJsonPath('categories.0.id', $b);
    }

    public function testDeletingAServerRemovesItFromLayouts(): void
    {
        $this->actingAs($this->user)->putJson('/api/client/account/layout/order', ['servers' => $this->uuids('Alpha', 'Bravo')])->assertOk();
        $this->actingAs($this->user)->postJson('/api/client/account/layout/categories', ['name' => 'X', 'servers' => $this->uuids('Alpha')])->assertCreated();

        $alpha = $this->servers['Alpha'];
        DB::table('servers')->where('id', $alpha->id)->delete();

        $this->assertDatabaseMissing('user_server_preferences', ['server_id' => $alpha->id]);
        $this->assertDatabaseMissing('user_server_category_members', ['server_id' => $alpha->id]);
    }

    public function testGuestsAreRefused(): void
    {
        $this->getJson('/api/client/account/layout')->assertUnauthorized();
        $this->putJson('/api/client/account/layout/order', ['servers' => []])->assertUnauthorized();
    }

    public function testIconColorsAreStoredPerUserAndClearable(): void
    {
        $alpha = $this->servers['Alpha']->uuid;
        $other = User::factory()->create();
        Subuser::query()->create(['user_id' => $other->id, 'server_id' => $this->servers['Alpha']->id, 'permissions' => ['websocket.connect']]);
        $color = fn (User $u) => collect($this->actingAs($u)->getJson('/api/client/account/layout')->json('servers'))->firstWhere('uuid', $alpha)['color'];

        $this->actingAs($this->user)->putJson("/api/client/account/layout/servers/$alpha/color", ['color' => '#A855F7'])->assertOk();
        $this->assertSame('#a855f7', $color($this->user));
        $this->assertNull($color($other), 'another user keeps the default colour');

        $this->actingAs($this->user)->putJson("/api/client/account/layout/servers/$alpha/color", ['color' => null])->assertOk();
        $this->assertNull($color($this->user));
    }

    public function testIconColorsAreValidatedAndOnlyForServersTheUserCanOpen(): void
    {
        $alpha = $this->servers['Alpha']->uuid;
        foreach (['red', '#12345', '#12345g', 'javascript:1', '#1234567'] as $bad) {
            $this->actingAs($this->user)->putJson("/api/client/account/layout/servers/$alpha/color", ['color' => $bad])->assertUnprocessable();
        }
        $this->actingAs($this->user)->putJson("/api/client/account/layout/servers/$alpha/color", [])->assertUnprocessable();

        $stranger = User::factory()->create();
        $this->actingAs($stranger)->putJson("/api/client/account/layout/servers/$alpha/color", ['color' => '#ffffff'])->assertStatus(400);
        $this->assertDatabaseMissing('user_server_icon_colors', ['server_id' => $this->servers['Alpha']->id]);
    }

    public function testRecentColoursAreNewestFirstDeduplicatedAndLimitedToFive(): void
    {
        $alpha = $this->servers['Alpha']->uuid;
        $recent = fn () => $this->actingAs($this->user)->getJson('/api/client/account/layout')->json('recent_colors');

        foreach (['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'] as $hex) {
            $this->actingAs($this->user)->putJson("/api/client/account/layout/servers/$alpha/color", ['color' => $hex])->assertOk();
        }
        $this->assertSame(['#666666', '#555555', '#444444', '#333333', '#222222'], $recent());

        // Reusing an older colour moves it to the front instead of adding a second copy.
        $this->actingAs($this->user)->putJson("/api/client/account/layout/servers/$alpha/color", ['color' => '#333333'])->assertOk();
        $this->assertSame(['#333333', '#666666', '#555555', '#444444', '#222222'], $recent());

        // Case is normalised, and resetting a colour does not erase the history.
        $this->actingAs($this->user)->putJson("/api/client/account/layout/servers/$alpha/color", ['color' => '#AABBCC'])->assertOk();
        $this->actingAs($this->user)->putJson("/api/client/account/layout/servers/$alpha/color", ['color' => null])->assertOk();
        $this->assertSame('#aabbcc', $recent()[0]);
        $this->assertCount(5, $recent());

        $other = User::factory()->create();
        $this->assertSame([], $this->actingAs($other)->getJson('/api/client/account/layout')->json('recent_colors'));
    }
}
