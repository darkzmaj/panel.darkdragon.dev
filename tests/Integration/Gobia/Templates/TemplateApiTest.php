<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Integration\Gobia\Templates;

use GobiaTemplates\Jobs\ProvisionTemplateInstanceJob;
use GobiaTemplates\Models\ServerTemplate;
use GobiaTemplates\Models\TemplateInstance;
use Illuminate\Support\Facades\Queue;
use Pterodactyl\Models\ApiKey;
use Pterodactyl\Models\User;
use Pterodactyl\Services\Acl\Api\AdminAcl;
use Pterodactyl\Tests\Integration\Gobia\BuildsTemplates;
use Pterodactyl\Tests\Integration\IntegrationTestCase;

/** The application API for automation: strict key checks, an explicit per template API switch, safe retries. */
class TemplateApiTest extends IntegrationTestCase
{
    use BuildsTemplates;

    private const BASE = '/api/application/extensions/gobia-templates/templates';

    private ServerTemplate $template;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootTemplates();
        Queue::fake();
        $this->makeNode();
        $this->template = $this->makeTemplate(['api_enabled' => true]);
        $this->admin = User::factory()->create(['root_admin' => true]);
    }

    protected function tearDown(): void
    {
        $this->shutdownTemplates();
        parent::tearDown();
    }

    public function test_no_key_and_no_session_means_no_access(): void
    {
        $this->getJson(self::BASE)->assertUnauthorized();
        $this->postJson($this->url('/instances'), $this->body())->assertUnauthorized();
    }

    public function test_keys_without_server_permissions_are_refused_everywhere(): void
    {
        $instance = $this->queued();
        $this->key(AdminAcl::NONE);

        $this->getJson(self::BASE)->assertForbidden();
        $this->getJson($this->url())->assertForbidden();
        $this->postJson($this->url('/instances'), $this->body())->assertForbidden();
        $this->getJson($this->url('/instances/'.$instance->uuid))->assertForbidden();
        $this->postJson($this->url('/instances/'.$instance->uuid.'/retry'))->assertForbidden();
        $this->deleteJson($this->url('/instances/'.$instance->uuid))->assertForbidden();
    }

    public function test_read_only_keys_can_look_but_never_create_retry_or_delete(): void
    {
        $instance = $this->queued();
        $this->key(AdminAcl::READ);

        $this->getJson(self::BASE)->assertOk()->assertJsonPath('data.0.name', 'Lobby');
        $this->getJson($this->url())->assertOk();
        $this->getJson($this->url('/instances/'.$instance->uuid))->assertOk()->assertJsonPath('state', 'queued');
        $this->postJson($this->url('/instances'), $this->body())->assertForbidden();
        $this->postJson($this->url('/instances/'.$instance->uuid.'/retry'))->assertForbidden();
        $this->deleteJson($this->url('/instances/'.$instance->uuid))->assertForbidden();
    }

    public function test_an_administrators_account_key_and_session_do_not_bypass_the_key_checks(): void
    {
        $account = ApiKey::factory()->create(['user_id' => $this->admin->id, 'key_type' => ApiKey::TYPE_ACCOUNT]);
        $this->withHeader('Authorization', 'Bearer '.$account->identifier.decrypt($account->token));
        $this->getJson(self::BASE)->assertForbidden();

        $this->app['auth']->forgetGuards();
        $this->withHeaders(['Authorization' => ''])->actingAs($this->admin);
        $this->postJson($this->url('/instances'), $this->body())->assertForbidden();
    }

    public function test_only_templates_opened_to_the_api_can_be_used(): void
    {
        $private = $this->makeTemplate(['name' => 'Private', 'api_enabled' => false]);
        $this->key(AdminAcl::READ | AdminAcl::WRITE);

        $listed = collect($this->getJson(self::BASE)->assertOk()->json('data'))->pluck('name')->all();
        $this->assertSame(['Lobby'], $listed);
        $this->getJson($this->url('', $private))->assertNotFound();
        $this->postJson($this->url('/instances', $private), $this->body())->assertNotFound();

        $this->template->forceFill(['enabled' => false])->save();
        $this->postJson($this->url('/instances'), $this->body())->assertNotFound();
    }

    public function test_creating_an_instance_queues_provisioning_and_returns_a_location(): void
    {
        $this->key(AdminAcl::READ | AdminAcl::WRITE);

        $response = $this->postJson($this->url('/instances'), $this->body(['description' => 'hi', 'environment' => ['SERVER_JARFILE' => 'custom.jar']]))
            ->assertStatus(202)
            ->assertJsonPath('state', 'queued')
            ->assertJsonPath('name', 'Lobby 1');
        $response->assertHeader('Location');
        Queue::assertPushed(ProvisionTemplateInstanceJob::class, 1);
        $this->assertSame($this->template->revision, TemplateInstance::query()->firstOrFail()->template_revision);
    }

    public function test_requests_may_only_carry_the_allowed_fields_and_overridable_variables(): void
    {
        $this->key(AdminAcl::READ | AdminAcl::WRITE);

        $this->postJson($this->url('/instances'), $this->body(['memory' => 99999]))->assertUnprocessable();
        $this->postJson($this->url('/instances'), $this->body(['docker_image' => 'evil/x']))->assertUnprocessable();
        $this->postJson($this->url('/instances'), $this->body(['environment' => ['BUNGEE_VERSION' => '999']]))->assertUnprocessable();
        $this->postJson($this->url('/instances'), ['name' => 'x'])->assertUnprocessable();
        $this->postJson($this->url('/instances'), $this->body(['owner_id' => 99999999]))->assertUnprocessable();
        Queue::assertNothingPushed();
    }

    public function test_the_same_idempotency_key_returns_the_original_job_and_a_changed_body_is_a_conflict(): void
    {
        $this->key(AdminAcl::READ | AdminAcl::WRITE);
        $headers = ['Idempotency-Key' => 'order-1001'];

        $first = $this->postJson($this->url('/instances'), $this->body(), $headers)->assertStatus(202)->json('id');
        $again = $this->postJson($this->url('/instances'), $this->body(), $headers)->assertStatus(200)->json('id');
        $this->assertSame($first, $again);
        $this->assertSame(1, TemplateInstance::query()->count());

        $this->postJson($this->url('/instances'), $this->body(['name' => 'Different']), $headers)->assertStatus(409);
        $this->postJson($this->url('/instances'), $this->body(), ['Idempotency-Key' => 'bad key!'])->assertUnprocessable();
        Queue::assertPushed(ProvisionTemplateInstanceJob::class, 1);
    }

    public function test_instances_of_other_templates_are_not_reachable_through_this_one(): void
    {
        $instance = $this->queued();
        $other = $this->makeTemplate(['name' => 'Other', 'api_enabled' => true]);

        $this->getJson($this->url('/instances/'.$instance->uuid, $other))->assertNotFound();
        $this->deleteJson($this->url('/instances/'.$instance->uuid, $other))->assertNotFound();
    }

    public function test_only_failed_instances_can_be_retried_and_only_finished_ones_deleted(): void
    {
        $instance = $this->queued();

        $this->postJson($this->url('/instances/'.$instance->uuid.'/retry'))->assertStatus(400);
        $this->deleteJson($this->url('/instances/'.$instance->uuid))->assertStatus(400);

        $instance->forceFill(['state' => TemplateInstance::STATE_FAILED, 'error' => 'x'])->save();
        $this->postJson($this->url('/instances/'.$instance->uuid.'/retry'))->assertStatus(202)->assertJsonPath('state', 'queued');

        $instance->forceFill(['state' => TemplateInstance::STATE_READY])->save();
        $this->template->forceFill(['allow_instance_delete' => false])->save();
        $this->deleteJson($this->url('/instances/'.$instance->uuid))->assertStatus(400);
        $this->template->forceFill(['allow_instance_delete' => true])->save();
        $this->deleteJson($this->url('/instances/'.$instance->uuid))->assertNoContent();
    }

    /** Authenticates every following request with a new application key holding the given servers permission. */
    private function key(int $servers): ApiKey
    {
        $this->app['auth']->forgetGuards();
        $key = ApiKey::factory()->create(['user_id' => $this->admin->id, 'key_type' => ApiKey::TYPE_APPLICATION, 'r_servers' => $servers]);
        $this->withHeader('Authorization', 'Bearer '.$key->identifier.decrypt($key->token));

        return $key;
    }

    private function url(string $suffix = '', ?ServerTemplate $template = null): string
    {
        return self::BASE.'/'.($template ?? $this->template)->id.$suffix;
    }

    private function body(array $override = []): array
    {
        return $override + ['name' => 'Lobby 1', 'owner_id' => $this->admin->id];
    }

    private function queued(): TemplateInstance
    {
        $this->key(AdminAcl::READ | AdminAcl::WRITE);
        $uuid = $this->postJson($this->url('/instances'), $this->body())->assertStatus(202)->json('id');

        return TemplateInstance::query()->where('uuid', $uuid)->firstOrFail();
    }
}
