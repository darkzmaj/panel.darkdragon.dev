<?php

namespace Pterodactyl\Tests\Integration\Api\Application\Templates;

use Pterodactyl\Models\User;
use Pterodactyl\Models\ApiKey;
use Pterodactyl\Models\Server;
use Illuminate\Support\Facades\Queue;
use Pterodactyl\Models\ServerTemplate;
use Pterodactyl\Models\TemplateInstance;
use Pterodactyl\Services\Acl\Api\AdminAcl;
use Pterodactyl\Jobs\ProvisionTemplateInstanceJob;
use Pterodactyl\Tests\Traits\Integration\BuildsTemplates;
use Pterodactyl\Repositories\Wings\DaemonServerRepository;
use Pterodactyl\Tests\Traits\Integration\RemovesAddedRows;
use Pterodactyl\Tests\Integration\Api\Application\ApplicationApiIntegrationTestCase;

class TemplateInstanceApiTest extends ApplicationApiIntegrationTestCase
{
    use BuildsTemplates;
    use RemovesAddedRows;

    // The Panel's exception handler rolls back any open transaction when it renders an error, which would wipe the
    // fixtures of a test that expects error responses. So these tests do not run in a transaction; instead they
    // remember how far every table had grown and remove what they added (see removeAddedRows()).
    protected array $connectionsToTransact = [];

    private ServerTemplate $template;

    public function setUp(): void
    {
        parent::setUp();
        $this->useTemplateStorage();

        $this->rememberHighWater();
        Queue::fake();
        $this->makeNode();
        $this->template = $this->makeTemplate();
    }

    public function tearDown(): void
    {
        $this->removeTemplateStorage();
        $this->removeAddedRows();
        // The API user and key were created by the parent setUp, before the high-water mark was taken.
        ApiKey::query()->where('user_id', $this->getApiUser()->id)->delete();
        User::query()->whereKey($this->getApiUser()->id)->delete();
        parent::tearDown();
    }

    private function grant(array $permissions): ApiKey
    {
        // The auth guard remembers the first token it saw; forget it so the new key is really used.
        $this->app['auth']->forgetGuards();

        return $this->createNewDefaultApiKey($this->getApiUser(), $permissions);
    }

    private function url(string $suffix = ''): string
    {
        return '/api/application/templates/' . $this->template->id . $suffix;
    }

    private function body(array $override = []): array
    {
        return $override + ['name' => 'Lobby 1', 'owner_id' => $this->getApiUser()->id];
    }

    private function createScope(): array
    {
        return ['r_template_instance_create' => AdminAcl::WRITE];
    }

    public function testKeysWithoutTemplatePermissionsAreRefusedEverywhere(): void
    {
        // The default test key can manage servers, nodes, users... but was never granted templates.
        $instance = $this->queued();

        $this->getJson('/api/application/templates')->assertForbidden();
        $this->getJson($this->url())->assertForbidden();
        $this->postJson($this->url('/instances'), $this->body())->assertForbidden();
        $this->getJson($this->url('/instances/' . $instance->uuid))->assertForbidden();
        $this->postJson($this->url('/instances/' . $instance->uuid . '/retry'))->assertForbidden();
        $this->deleteJson($this->url('/instances/' . $instance->uuid))->assertForbidden();

        Queue::assertNothingPushed();
    }

    public function testEachPermissionOnlyGrantsItsOwnEndpoints(): void
    {
        $instance = $this->queued();

        $this->grant(['r_templates' => AdminAcl::READ]);
        $this->getJson('/api/application/templates')->assertOk();
        $this->getJson($this->url('/instances/' . $instance->uuid))->assertOk();
        $this->postJson($this->url('/instances'), $this->body())->assertForbidden();
        $this->deleteJson($this->url('/instances/' . $instance->uuid))->assertForbidden();

        $this->grant($this->createScope());
        $this->postJson($this->url('/instances'), $this->body())->assertStatus(202);
        $this->getJson('/api/application/templates')->assertForbidden();
        $this->deleteJson($this->url('/instances/' . $instance->uuid))->assertForbidden();

        $this->grant(['r_template_instance_delete' => AdminAcl::WRITE]);
        $this->postJson($this->url('/instances'), $this->body())->assertForbidden();
        $this->deleteJson($this->url('/instances/' . $instance->uuid))->assertStatus(400); // not finished, but authorized
    }

    public function testReadOnlyCreateOrDeleteLevelIsNotEnough(): void
    {
        $this->grant(['r_template_instance_create' => AdminAcl::READ]);
        $this->postJson($this->url('/instances'), $this->body())->assertForbidden();
    }

    public function testAnAdministratorsAccountKeyDoesNotBypassTheTemplatePermissions(): void
    {
        $key = ApiKey::factory()->create(['user_id' => $this->getApiUser()->id, 'key_type' => ApiKey::TYPE_ACCOUNT]);
        $this->withHeader('Authorization', 'Bearer ' . $key->identifier . decrypt($key->token));

        $this->getJson('/api/application/templates')->assertForbidden();
        $this->postJson($this->url('/instances'), $this->body())->assertForbidden();
    }

    public function testRequestsWithoutACredentialAreRejected(): void
    {
        $this->withHeader('Authorization', '');
        $this->postJson($this->url('/instances'), $this->body())->assertUnauthorized();
        $this->withHeader('Authorization', 'Bearer ptla_notarealkey');
        $this->getJson('/api/application/templates')->assertUnauthorized();
    }

    public function testCreatingAnInstanceQueuesAJobAndReturnsItsId(): void
    {
        $this->grant($this->createScope() + ['r_templates' => AdminAcl::READ]);

        $response = $this->postJson($this->url('/instances'), $this->body())->assertStatus(202)
            ->assertJsonPath('attributes.state', 'queued')
            ->assertJsonPath('attributes.template', $this->template->id)
            ->assertJsonPath('attributes.template_revision', 1);

        $id = $response->json('attributes.id');
        $response->assertHeader('Location', url('/api/application/templates/' . $this->template->id . '/instances/' . $id));
        Queue::assertPushed(ProvisionTemplateInstanceJob::class, 1);
        // The Panel's workers only listen on high, standard and low.
        Queue::assertPushedOn('standard', ProvisionTemplateInstanceJob::class);
        $response->assertJsonPath('attributes.attempts', 0);

        $this->getJson($this->url('/instances/' . $id))->assertOk()->assertJsonPath('attributes.id', $id)->assertJsonPath('attributes.finished', false);
    }

    /**
     * @dataProvider forbiddenFields
     */
    public function testOnlyAllowlistedFieldsAreAccepted(string $field, $value): void
    {
        $this->grant($this->createScope());

        $this->postJson($this->url('/instances'), $this->body([$field => $value]))->assertUnprocessable()->assertJsonPath('errors.0.meta.source_field', $field);

        $this->assertSame(0, $this->instanceCount());
        Queue::assertNothingPushed();
    }

    public static function forbiddenFields(): array
    {
        return [
            'memory' => ['memory', 999999],
            'disk' => ['disk', 999999],
            'startup command' => ['startup', 'rm -rf /'],
            'docker image' => ['docker_image', 'evil/image'],
            'image' => ['image', 'evil/image'],
            'node' => ['node_id', 1],
            'allocation' => ['allocation_id', 1],
            'egg' => ['egg_id', 1],
            'files' => ['files', [['path' => '../../x', 'content' => 'x']]],
            'path' => ['path', '/etc/passwd'],
            'shell' => ['command', 'id'],
            'uuid' => ['uuid', 'attacker'],
            'state' => ['state', 'ready'],
            'revision' => ['template_revision', 99],
        ];
    }

    public function testEnvironmentOverridesAreLimitedToVariablesTheTemplateAllows(): void
    {
        $this->grant($this->createScope());

        $this->postJson($this->url('/instances'), $this->body(['environment' => ['SERVER_JARFILE' => 'mine.jar']]))->assertStatus(202);
        $stored = TemplateInstance::query()->latest('id')->first();
        $this->assertSame(['SERVER_JARFILE' => 'mine.jar'], $stored->overrides['environment']);

        // BUNGEE_VERSION is fixed by the template, and unknown variables do not exist.
        $this->postJson($this->url('/instances'), $this->body(['name' => 'b', 'environment' => ['BUNGEE_VERSION' => '1']]))->assertUnprocessable();
        $this->postJson($this->url('/instances'), $this->body(['name' => 'c', 'environment' => ['EVIL' => '1']]))->assertUnprocessable();
        // Values still have to satisfy the variable's own rules.
        $this->postJson($this->url('/instances'), $this->body(['name' => 'd', 'environment' => ['SERVER_JARFILE' => str_repeat('x', 5000)]]))->assertUnprocessable();
    }

    public function testInputIsValidated(): void
    {
        $this->grant($this->createScope());

        $this->postJson($this->url('/instances'), ['owner_id' => $this->getApiUser()->id])->assertUnprocessable();
        $this->postJson($this->url('/instances'), ['name' => 'x'])->assertUnprocessable();
        $this->postJson($this->url('/instances'), $this->body(['owner_id' => 999999]))->assertUnprocessable();
        $this->postJson($this->url('/instances'), $this->body(['name' => str_repeat('a', 192)]))->assertUnprocessable();
    }

    public function testDisabledTemplatesCannotBeUsed(): void
    {
        $this->grant($this->createScope());
        $this->template->update(['enabled' => false]);

        $this->postJson($this->url('/instances'), $this->body())->assertStatus(400);
        Queue::assertNothingPushed();
    }

    public function testIdempotencyKeysReturnTheOriginalInstance(): void
    {
        $this->grant($this->createScope());
        $headers = ['Idempotency-Key' => 'order-1234'];

        $first = $this->postJson($this->url('/instances'), $this->body(), $headers)->assertStatus(202);
        $second = $this->postJson($this->url('/instances'), $this->body(), $headers)->assertStatus(200);

        $this->assertSame($first->json('attributes.id'), $second->json('attributes.id'));
        $this->assertSame(1, $this->instanceCount());
        Queue::assertPushed(ProvisionTemplateInstanceJob::class, 1);

        // Reusing a key for a different request is a conflict, never a silent second server.
        $this->postJson($this->url('/instances'), $this->body(['name' => 'Different']), $headers)->assertStatus(409);
        $this->assertSame(1, $this->instanceCount());

        // Without a key every request is independent.
        $this->postJson($this->url('/instances'), $this->body())->assertStatus(202);
        $this->postJson($this->url('/instances'), $this->body())->assertStatus(202);
        $this->assertSame(3, $this->instanceCount());
    }

    public function testIdempotencyKeysAreScopedPerTemplateAndValidated(): void
    {
        $this->grant($this->createScope());
        $other = $this->makeTemplate(['name' => 'Other']);

        $this->postJson($this->url('/instances'), $this->body(), ['Idempotency-Key' => 'same'])->assertStatus(202);
        $this->postJson('/api/application/templates/' . $other->id . '/instances', $this->body(), ['Idempotency-Key' => 'same'])->assertStatus(202);

        $this->postJson($this->url('/instances'), $this->body(['name' => 'x']), ['Idempotency-Key' => 'bad key with spaces!'])->assertUnprocessable();
        $this->postJson($this->url('/instances'), $this->body(['name' => 'y']), ['Idempotency-Key' => str_repeat('k', 81)])->assertUnprocessable();
    }

    public function testAnInstanceIsOnlyReachableThroughItsOwnTemplate(): void
    {
        $this->grant(['r_templates' => AdminAcl::READ, 'r_template_instance_delete' => AdminAcl::WRITE]);
        $other = $this->makeTemplate(['name' => 'Other']);
        $instance = $this->queued();

        $this->getJson('/api/application/templates/' . $other->id . '/instances/' . $instance->uuid)->assertNotFound();
        $this->deleteJson('/api/application/templates/' . $other->id . '/instances/' . $instance->uuid)->assertNotFound();
        $this->getJson($this->url('/instances/00000000-0000-0000-0000-000000000000'))->assertNotFound();
    }

    public function testTheStatusEndpointExposesProgressAndSanitizedErrorsOnly(): void
    {
        $this->grant(['r_templates' => AdminAcl::READ]);
        $instance = $this->queued();
        $instance->forceFill(['state' => 'failed', 'failed_stage' => 'installing', 'error' => 'The server installation failed.'])->save();

        $this->getJson($this->url('/instances/' . $instance->uuid))->assertOk()
            ->assertJsonPath('attributes.state', 'failed')
            ->assertJsonPath('attributes.failed_stage', 'installing')
            ->assertJsonPath('attributes.finished', true)
            ->assertJsonMissingPath('attributes.overrides')
            ->assertJsonMissingPath('attributes.request_hash');
    }

    public function testRetryNeedsTheCreatePermissionAndAFailedInstance(): void
    {
        $this->grant($this->createScope());
        $instance = $this->queued();

        $this->postJson($this->url('/instances/' . $instance->uuid . '/retry'))->assertStatus(400);

        $instance->forceFill(['state' => 'failed'])->save();
        $this->postJson($this->url('/instances/' . $instance->uuid . '/retry'))->assertStatus(202)->assertJsonPath('attributes.state', 'queued');
    }

    public function testDeletingAnInstanceRemovesItsServer(): void
    {
        $this->grant(['r_template_instance_delete' => AdminAcl::WRITE]);
        $server = $this->createServerModel();
        $instance = $this->queued();
        $instance->forceFill(['state' => 'ready', 'server_id' => $server->id])->save();

        $daemon = \Mockery::mock(DaemonServerRepository::class);
        $daemon->shouldReceive('setServer')->andReturnSelf();
        $daemon->shouldReceive('delete')->once();
        $this->swap(DaemonServerRepository::class, $daemon);

        $this->deleteJson($this->url('/instances/' . $instance->uuid))->assertNoContent();

        $this->assertDatabaseMissing('servers', ['id' => $server->id]);
        $this->assertNull($instance->refresh()->server_id);
    }

    public function testTemplatesCanForbidApiDeletion(): void
    {
        $this->grant(['r_template_instance_delete' => AdminAcl::WRITE]);
        $this->template->update(['allow_instance_delete' => false]);
        $server = $this->createServerModel();
        $instance = $this->queued();
        $instance->forceFill(['state' => 'ready', 'server_id' => $server->id])->save();

        $this->deleteJson($this->url('/instances/' . $instance->uuid))->assertStatus(400);
        $this->assertDatabaseHas('servers', ['id' => $server->id]);
    }

    public function testRunningInstancesCannotBeDeleted(): void
    {
        $this->grant(['r_template_instance_delete' => AdminAcl::WRITE]);
        $instance = $this->queued();

        $this->deleteJson($this->url('/instances/' . $instance->uuid))->assertStatus(400);
        $this->assertDatabaseHas('server_template_instances', ['id' => $instance->id]);
    }

    public function testTemplateEndpointsDoNotLeakFilesOrStartupDetails(): void
    {
        $this->grant(['r_templates' => AdminAcl::READ]);
        app(\Pterodactyl\Services\Templates\TemplateService::class)->putFile($this->template, 'secret.yml', 'password: hunter2');
        $this->template->update(['startup' => 'java -jar secret.jar']);

        $body = $this->getJson($this->url())->assertOk()->getContent();
        $this->assertStringNotContainsString('hunter2', $body);
        $this->assertStringNotContainsString('secret.jar', $body);
        $this->assertStringNotContainsString('secret.yml', $body);
    }

    private function instanceCount(): int
    {
        return TemplateInstance::query()->where('template_id', $this->template->id)->count();
    }

    private function queued(): TemplateInstance
    {
        return TemplateInstance::query()->create([
            'uuid' => (string) \Ramsey\Uuid\Uuid::uuid4(),
            'template_id' => $this->template->id,
            'template_revision' => 1,
            'owner_id' => User::factory()->create()->id,
            'name' => 'Existing',
            'state' => 'queued',
        ]);
    }
}
