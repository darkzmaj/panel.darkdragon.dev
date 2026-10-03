<?php

namespace Pterodactyl\Tests\Integration\Services\Templates;

use Illuminate\Support\Facades\Queue;
use Pterodactyl\Models\TemplateInstance;
use Pterodactyl\Tests\Integration\IntegrationTestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Pterodactyl\Services\Templates\TemplateNameService;
use Pterodactyl\Tests\Traits\Integration\BuildsTemplates;
use Pterodactyl\Services\Templates\TemplateInstanceService;

class TemplateNameServiceTest extends IntegrationTestCase
{
    use BuildsTemplates;
    use DatabaseTransactions;

    public function setUp(): void
    {
        parent::setUp();
        $this->useTemplateStorage();
        Queue::fake();
    }

    public function tearDown(): void
    {
        $this->removeTemplateStorage();
        parent::tearDown();
    }

    private function names(): TemplateNameService
    {
        return app(TemplateNameService::class);
    }

    private function serverNamed(string $name): void
    {
        $this->createServerModel(['name' => $name]);
    }

    public function testTheFirstNumberIsOneAndNamesWithoutPlaceholdersAreUntouched(): void
    {
        $this->assertSame('SloBlock Hub 1', $this->names()->expand('SloBlock Hub %number%'));
        $this->assertSame('Plain name', $this->names()->expand('Plain name'));
        $this->assertFalse($this->names()->hasPlaceholders('Plain name'));
        $this->assertTrue($this->names()->hasPlaceholders('Hub %number%'));
    }

    public function testTheNextNumberFollowsTheHighestInUseNotTheDatabaseId(): void
    {
        foreach (['SloBlock Hub 1', 'SloBlock Hub 2', 'SloBlock Hub 3'] as $name) {
            $this->serverNamed($name);
        }
        $this->assertSame('SloBlock Hub 4', $this->names()->expand('SloBlock Hub %number%'));

        // Gaps are not reused: 1, 2 and 4 gives 5, so a deleted instance's name is never handed to another server.
        $this->serverNamed('SloBlock Hub 7');
        $this->assertSame('SloBlock Hub 8', $this->names()->expand('SloBlock Hub %number%'));
    }

    public function testOnlyNamesMatchingTheWholePatternCount(): void
    {
        $this->serverNamed('Lobby 40 extra');
        $this->serverNamed('My Lobby 90');
        $this->serverNamed('Lobby');
        $this->serverNamed('Lobby 5');

        $this->assertSame('Lobby 6', $this->names()->expand('Lobby %number%'));
        $this->assertSame('Lobby 41 extra', $this->names()->expand('Lobby %number% extra'));
    }

    public function testRegexAndLikeCharactersInThePatternAreTreatedLiterally(): void
    {
        $this->serverNamed('Hub (v1.0) [EU] 9');
        $this->serverNamed('Hub (v1x0) [EU] 50');
        $this->serverNamed('100%_hub 3');
        $this->serverNamed('100xxhub 80');

        $this->assertSame('Hub (v1.0) [EU] 10', $this->names()->expand('Hub (v1.0) [EU] %number%'));
        $this->assertSame('100%_hub 4', $this->names()->expand('100%_hub %number%'));
    }

    public function testARepeatedPlaceholderUsesTheSameNumber(): void
    {
        $this->serverNamed('Hub 3-3');
        $this->serverNamed('Hub 9-4');

        $this->assertSame('Hub 4-4', $this->names()->expand('Hub %number%-%number%'));
    }

    public function testInstancesStillBeingProvisionedCountButFailedOnesDoNot(): void
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

    public function testRequestsWithAPlaceholderGetDistinctSequentialNames(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate();
        $owner = \Pterodactyl\Models\User::factory()->create();
        $service = app(TemplateInstanceService::class);

        $names = [];
        for ($i = 0; $i < 3; ++$i) {
            [$instance] = $service->request($template, ['name' => 'Hub %number%', 'owner_id' => $owner->id]);
            $names[] = $instance->name;
        }

        $this->assertSame(['Hub 1', 'Hub 2', 'Hub 3'], $names);
    }

    public function testRetryingAnIdempotentRequestDoesNotConsumeANewNumber(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate();
        $owner = \Pterodactyl\Models\User::factory()->create();
        $service = app(TemplateInstanceService::class);

        [$first] = $service->request($template, ['name' => 'Hub %number%', 'owner_id' => $owner->id], null, 'key-1');
        [$again, $created] = $service->request($template, ['name' => 'Hub %number%', 'owner_id' => $owner->id], null, 'key-1');

        $this->assertFalse($created);
        $this->assertSame($first->id, $again->id);
        $this->assertSame('Hub 1', $again->name);
        $this->assertSame('Hub 2', $this->names()->expand('Hub %number%'));
    }
}
