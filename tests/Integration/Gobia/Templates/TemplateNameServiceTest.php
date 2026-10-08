<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Integration\Gobia\Templates;

use GobiaTemplates\Models\TemplateInstance;
use GobiaTemplates\Services\TemplateInstanceService;
use GobiaTemplates\Services\TemplateNameService;
use Illuminate\Support\Facades\Queue;
use Pterodactyl\Tests\Integration\Gobia\BuildsTemplates;
use Pterodactyl\Tests\Integration\IntegrationTestCase;

class TemplateNameServiceTest extends IntegrationTestCase
{
    use BuildsTemplates;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootTemplates();
        Queue::fake();
    }

    protected function tearDown(): void
    {
        $this->shutdownTemplates();
        $this->removeTemplateFixtures();
        parent::tearDown();
    }

    public function test_the_first_number_is_one_and_names_without_placeholders_are_untouched(): void
    {
        $this->assertSame('SloBlock Hub 1', $this->names()->expand('SloBlock Hub %number%'));
        $this->assertSame('Plain name', $this->names()->expand('Plain name'));
        $this->assertFalse($this->names()->hasPlaceholders('Plain name'));
        $this->assertTrue($this->names()->hasPlaceholders('Hub %number%'));
    }

    public function test_the_next_number_follows_the_highest_in_use_not_the_database_id(): void
    {
        foreach (['SloBlock Hub 1', 'SloBlock Hub 2', 'SloBlock Hub 3'] as $name) {
            $this->serverNamed($name);
        }
        $this->assertSame('SloBlock Hub 4', $this->names()->expand('SloBlock Hub %number%'));

        // Gaps are not reused: 1, 2 and 4 gives 5, so a deleted instance's name is never handed to another server.
        $this->serverNamed('SloBlock Hub 7');
        $this->assertSame('SloBlock Hub 8', $this->names()->expand('SloBlock Hub %number%'));
    }

    public function test_only_names_matching_the_whole_pattern_count(): void
    {
        $this->serverNamed('Lobby 40 extra');
        $this->serverNamed('My Lobby 90');
        $this->serverNamed('Lobby');
        $this->serverNamed('Lobby 5');

        $this->assertSame('Lobby 6', $this->names()->expand('Lobby %number%'));
        $this->assertSame('Lobby 41 extra', $this->names()->expand('Lobby %number% extra'));
    }

    public function test_regex_and_like_characters_in_the_pattern_are_treated_literally(): void
    {
        $this->serverNamed('Hub (v1.0) [EU] 9');
        $this->serverNamed('Hub (v1x0) [EU] 50');
        $this->serverNamed('100%_hub 3');
        $this->serverNamed('100xxhub 80');

        $this->assertSame('Hub (v1.0) [EU] 10', $this->names()->expand('Hub (v1.0) [EU] %number%'));
        $this->assertSame('100%_hub 4', $this->names()->expand('100%_hub %number%'));
    }

    public function test_a_repeated_placeholder_uses_the_same_number(): void
    {
        $this->serverNamed('Hub 3-3');
        $this->serverNamed('Hub 9-4');

        $this->assertSame('Hub 4-4', $this->names()->expand('Hub %number%-%number%'));
    }

    public function test_instances_still_being_provisioned_count_but_failed_ones_do_not(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate();
        $owner = \Pterodactyl\Models\User::factory()->create();
        $make = fn (string $name, string $state) => TemplateInstance::query()->create([
            'uuid' => (string) \Ramsey\Uuid\Uuid::uuid4(), 'template_id' => $template->id, 'template_revision' => 1,
            'owner_id' => $owner->id, 'name' => $name, 'state' => $state,
        ]);

        $make('Queue 2', 'queued');
        $make('Queue 6', 'failed');
        $this->assertSame('Queue 3', $this->names()->expand('Queue %number%'));
    }

    public function test_requests_with_a_placeholder_get_distinct_sequential_names(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate();
        $owner = \Pterodactyl\Models\User::factory()->create();
        $service = app(TemplateInstanceService::class);

        $names = [];
        for ($i = 0; $i < 3; $i++) {
            [$instance] = $service->request($template, ['name' => 'Seq Hub %number%', 'owner_id' => $owner->id]);
            $names[] = $instance->name;
        }

        $this->assertSame(['Seq Hub 1', 'Seq Hub 2', 'Seq Hub 3'], $names);
    }

    public function test_retrying_an_idempotent_request_does_not_consume_a_new_number(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate();
        $owner = \Pterodactyl\Models\User::factory()->create();
        $service = app(TemplateInstanceService::class);

        [$first] = $service->request($template, ['name' => 'Seq Hub %number%', 'owner_id' => $owner->id], null, 'key-1');
        [$again, $created] = $service->request($template, ['name' => 'Seq Hub %number%', 'owner_id' => $owner->id], null, 'key-1');

        $this->assertFalse($created);
        $this->assertSame($first->id, $again->id);
        $this->assertSame('Seq Hub 1', $again->name);
        $this->assertSame('Seq Hub 2', $this->names()->expand('Seq Hub %number%'));
    }

    private function names(): TemplateNameService
    {
        return app(TemplateNameService::class);
    }

    private function serverNamed(string $name): void
    {
        $this->createServerModel(['name' => $name]);
    }
}
