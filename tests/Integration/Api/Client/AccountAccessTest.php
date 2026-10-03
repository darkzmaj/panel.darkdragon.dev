<?php

namespace Pterodactyl\Tests\Integration\Api\Client;

use Pterodactyl\Models\User;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Subuser;
use Pterodactyl\Models\Permission;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Route;
use Pterodactyl\Jobs\RevokeSftpAccessJob;
use Illuminate\Support\Facades\Notification;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Services\Subusers\SubuserCreationService;

class AccountAccessTest extends ClientApiIntegrationTestCase
{
    private User $owner;

    /** @var Server[] */
    private array $servers = [];

    public function setUp(): void
    {
        parent::setUp();

        Notification::fake();
        Bus::fake([RevokeSftpAccessJob::class]);

        $this->owner = User::factory()->create();
        foreach (['Proxy-01', 'Proxy-02', 'Hub-01'] as $name) {
            $this->servers[$name] = $this->createServerModel(['user_id' => $this->owner->id, 'name' => $name]);
        }
    }

    private function uuids(string ...$names): array
    {
        return array_map(fn ($name) => $this->servers[$name]->uuid, $names);
    }

    private function subusers(User $user): \Illuminate\Support\Collection
    {
        return Subuser::query()->where('user_id', $user->id)->get();
    }

    public function testOwnerSeesTheirServersAndNothingElse(): void
    {
        $this->createServerModel(); // someone else's server

        $this->actingAs($this->owner)->getJson('/api/client/account/access')
            ->assertOk()
            ->assertJsonCount(3, 'servers')
            ->assertJsonPath('grants', []);
    }

    public function testGuestsCannotUseTheEndpoints(): void
    {
        $this->getJson('/api/client/account/access')->assertUnauthorized();
        $this->postJson('/api/client/account/access', [])->assertUnauthorized();
    }

    public function testAccessCanBeGrantedToASingleOwnedServer(): void
    {
        $friend = User::factory()->create();

        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email,
            'servers' => $this->uuids('Proxy-01'),
            'permissions' => ['control.console', 'control.start'],
        ])->assertCreated();

        $rows = $this->subusers($friend);
        $this->assertCount(1, $rows);
        $this->assertSame($this->servers['Proxy-01']->id, $rows[0]->server_id);
        // The websocket permission is what lets a subuser open the console connection at all.
        $this->assertEqualsCanonicalizing(['control.console', 'control.start', Permission::ACTION_WEBSOCKET_CONNECT], $rows[0]->permissions);
    }

    public function testAccessCanBeGrantedToSeveralServersAtOnce(): void
    {
        $friend = User::factory()->create();

        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email,
            'servers' => $this->uuids('Proxy-01', 'Proxy-02', 'Hub-01'),
            'permissions' => ['control.console'],
        ])->assertCreated();

        $this->assertCount(3, $this->subusers($friend));
    }

    public function testAllServersAndFullPermissionsShortcuts(): void
    {
        $friend = User::factory()->create();

        $response = $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email,
            'all_servers' => true,
            'all_permissions' => true,
        ])->assertCreated();

        $this->assertCount(3, $this->subusers($friend));
        $grant = $response->json('grants.0');
        $this->assertTrue($grant['full_access']);
        $this->assertTrue($grant['all_servers']);
        $everything = app(\Pterodactyl\Services\Subusers\AccountAccessService::class)->allPermissions();
        $this->assertEqualsCanonicalizing(array_unique(array_merge($everything, [Permission::ACTION_WEBSOCKET_CONNECT])), $this->subusers($friend)[0]->permissions);
    }

    public function testUnknownPermissionsAreIgnoredAndAtLeastOneIsRequired(): void
    {
        $friend = User::factory()->create();

        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email, 'servers' => $this->uuids('Hub-01'), 'permissions' => ['control.console', 'admin.everything', 'file.*'],
        ])->assertCreated();
        $this->assertEqualsCanonicalizing(['control.console', Permission::ACTION_WEBSOCKET_CONNECT], $this->subusers($friend)[0]->permissions);

        $other = User::factory()->create();
        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $other->email, 'servers' => $this->uuids('Hub-01'), 'permissions' => ['not.a.permission'],
        ])->assertStatus(400);
        $this->assertCount(0, $this->subusers($other));
    }

    public function testPermissionsAndServersCanBeEdited(): void
    {
        $friend = User::factory()->create();
        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email, 'servers' => $this->uuids('Proxy-01', 'Proxy-02'), 'permissions' => ['control.console'],
        ])->assertCreated();

        // Drop Proxy-02, add Hub-01 and widen the permissions: one server removed, one added, one updated.
        $this->actingAs($this->owner)->putJson('/api/client/account/access/' . $friend->uuid, [
            'servers' => $this->uuids('Proxy-01', 'Hub-01'), 'permissions' => ['control.console', 'file.read'],
        ])->assertOk();

        $rows = $this->subusers($friend)->keyBy('server_id');
        $this->assertCount(2, $rows);
        $this->assertFalse($rows->has($this->servers['Proxy-02']->id));
        foreach (['Proxy-01', 'Hub-01'] as $name) {
            $this->assertContains('file.read', $rows[$this->servers[$name]->id]->permissions);
        }
    }

    public function testRemovingAllAccess(): void
    {
        $friend = User::factory()->create();
        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email, 'all_servers' => true, 'permissions' => ['control.console'],
        ])->assertCreated();

        $this->actingAs($this->owner)->deleteJson('/api/client/account/access/' . $friend->uuid)->assertNoContent();

        $this->assertCount(0, $this->subusers($friend));
        Bus::assertDispatched(RevokeSftpAccessJob::class);
    }

    public function testRevokingOneServerTriggersTokenRevocationForIt(): void
    {
        $friend = User::factory()->create();
        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email, 'servers' => $this->uuids('Proxy-01', 'Proxy-02'), 'permissions' => ['control.console'],
        ])->assertCreated();

        $this->actingAs($this->owner)->putJson('/api/client/account/access/' . $friend->uuid, [
            'servers' => $this->uuids('Proxy-01'), 'permissions' => ['control.console'],
        ])->assertOk();

        Bus::assertDispatched(RevokeSftpAccessJob::class, fn ($job) => $job->target->is($this->servers['Proxy-02']));
        Bus::assertNotDispatched(RevokeSftpAccessJob::class, fn ($job) => $job->target->is($this->servers['Proxy-01']));
    }

    public function testServersOwnedBySomeoneElseAreRejectedAndNothingIsChanged(): void
    {
        $friend = User::factory()->create();
        $stranger = $this->createServerModel();

        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email,
            'servers' => array_merge($this->uuids('Proxy-01'), [$stranger->uuid]),
            'permissions' => ['control.console'],
        ])->assertStatus(400);

        $this->assertCount(0, $this->subusers($friend), 'the owned server must not have been granted either');
    }

    public function testNonexistentServersAreRejected(): void
    {
        $friend = User::factory()->create();

        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email, 'servers' => ['3f1f0e26-0000-4000-8000-000000000000'], 'permissions' => ['control.console'],
        ])->assertStatus(400);
    }

    public function testASubuserCannotGrantAccessToServersTheyDoNotOwn(): void
    {
        $friend = User::factory()->create();
        $helper = User::factory()->create();
        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $helper->email, 'servers' => $this->uuids('Proxy-01'), 'permissions' => array_merge(['user.create', 'user.update'], ['control.console']),
        ])->assertCreated();

        $this->actingAs($helper)->postJson('/api/client/account/access', [
            'email' => $friend->email, 'servers' => $this->uuids('Proxy-01'), 'permissions' => ['control.console'],
        ])->assertStatus(400);
        $this->assertCount(0, $this->subusers($friend));

        // ...and does not see the owner's grants either.
        $this->actingAs($helper)->getJson('/api/client/account/access')->assertOk()->assertJsonPath('servers', [])->assertJsonPath('grants', []);
    }

    public function testOthersCannotEditOrRevokeSomeoneElsesGrants(): void
    {
        $friend = User::factory()->create();
        $intruder = User::factory()->create();
        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email, 'all_servers' => true, 'permissions' => ['control.console'],
        ])->assertCreated();

        $this->actingAs($intruder)->deleteJson('/api/client/account/access/' . $friend->uuid)->assertStatus(400);
        $this->actingAs($intruder)->putJson('/api/client/account/access/' . $friend->uuid, ['all_servers' => true, 'permissions' => ['control.console']])->assertStatus(400);
        $this->assertCount(3, $this->subusers($friend));
    }

    public function testOwnerCannotGrantThemselves(): void
    {
        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $this->owner->email, 'all_servers' => true, 'permissions' => ['control.console'],
        ])->assertStatus(400);
    }

    public function testUnknownEmailAddressesGetAnAccountLikeTheServerScreenDoes(): void
    {
        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => 'new.person@example.com', 'servers' => $this->uuids('Hub-01'), 'permissions' => ['control.console'],
        ])->assertCreated();

        $created = User::query()->where('email', 'new.person@example.com')->firstOrFail();
        $this->assertCount(1, $this->subusers($created));
    }

    public function testAMultiServerGrantIsAllOrNothing(): void
    {
        $friend = User::factory()->create();
        $calls = 0;
        // Fail while creating the access for the second server.
        $this->app->bind(SubuserCreationService::class, function () use (&$calls) {
            $real = new SubuserCreationService(
                $this->app->make(\Illuminate\Database\ConnectionInterface::class),
                $this->app->make(\Pterodactyl\Repositories\Eloquent\SubuserRepository::class),
                $this->app->make(\Pterodactyl\Services\Users\UserCreationService::class),
                $this->app->make(\Pterodactyl\Contracts\Repository\UserRepositoryInterface::class),
            );

            return new class ($real, $calls) extends SubuserCreationService {
                public function __construct(private SubuserCreationService $real, private int &$calls)
                {
                }

                public function handle(Server $server, string $email, array $permissions): Subuser
                {
                    if (++$this->calls === 2) {
                        throw new DisplayException('simulated failure on the second server');
                    }

                    return $this->real->handle($server, $email, $permissions);
                }
            };
        });

        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email, 'servers' => $this->uuids('Proxy-01', 'Proxy-02', 'Hub-01'), 'permissions' => ['control.console'],
        ])->assertStatus(400)->assertSee('simulated failure');

        $this->assertCount(0, $this->subusers($friend), 'servers granted before the failure were rolled back');
        Bus::assertNotDispatched(RevokeSftpAccessJob::class);
    }

    public function testGranteesCanActuallyUseTheirAccessAndOnlyWithinIt(): void
    {
        $friend = User::factory()->create();
        $this->actingAs($this->owner)->postJson('/api/client/account/access', [
            'email' => $friend->email, 'servers' => $this->uuids('Hub-01'), 'permissions' => ['control.console'],
        ])->assertCreated();

        // The ordinary server API recognises the access the account page created.
        $this->actingAs($friend)->getJson('/api/client/servers/' . $this->servers['Hub-01']->uuid)->assertOk();
        $this->actingAs($friend)->getJson('/api/client/servers/' . $this->servers['Proxy-01']->uuid)->assertNotFound();
        $this->actingAs($friend)->getJson('/api/client/servers/' . $this->servers['Hub-01']->uuid . '/files/list')->assertForbidden();
    }

    public function testExistingSubusersCreatedTheOldWayKeepWorking(): void
    {
        [$subuser, $server] = $this->generateTestAccount(['control.console']);

        $this->actingAs($subuser)->getJson('/api/client/servers/' . $server->uuid)->assertOk();
        $this->actingAs($server->user)->getJson('/api/client/servers/' . $server->uuid . '/users')->assertOk()->assertJsonCount(1, 'data');
    }

    public function testThePerServerSubuserApiStillExists(): void
    {
        $names = collect(Route::getRoutes()->getRoutes())->map(fn ($route) => $route->uri())->all();

        $this->assertContains('api/client/servers/{server}/users', $names);
        $this->assertContains('api/client/servers/{server}/users/{user}', $names);
    }
}
