<?php

namespace Pterodactyl\Tests\Integration\Api\Client;

use Pterodactyl\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Performance budget for the dashboard list: the number of SQL queries must not grow with the number of servers.
 */
class ServerListQueryTest extends ClientApiIntegrationTestCase
{
    private function queries(User $user, string $query): int
    {
        DB::enableQueryLog();
        DB::flushQueryLog();
        $this->actingAs($user)->getJson('/api/client' . $query)->assertOk();
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    }

    public function testTheLiteListUsesAFixedNumberOfQueriesWhateverTheServerCount(): void
    {
        $user = User::factory()->create();
        foreach (range(1, 3) as $i) {
            $this->createServerModel(['user_id' => $user->id, 'name' => "Few $i"]);
        }
        $this->queries($user, '?lite=1'); // warm caches
        $few = $this->queries($user, '?lite=1');

        foreach (range(1, 12) as $i) {
            $this->createServerModel(['user_id' => $user->id, 'name' => "Many $i"]);
        }
        $many = $this->queries($user, '?lite=1');

        $this->assertLessThanOrEqual($few + 1, $many, "3 servers took $few queries but 15 took $many");
        $this->assertLessThanOrEqual(14, $many, 'the dashboard list should need a small, fixed number of queries');
    }

    public function testTheLiteListKeepsWhatTheDashboardNeedsAndOnlyThePrimaryAllocation(): void
    {
        $user = User::factory()->create();
        $server = $this->createServerModel(['user_id' => $user->id, 'name' => 'Lite']);

        $row = $this->actingAs($user)->getJson('/api/client?lite=1')->assertOk()->json('data.0.attributes');

        $this->assertSame('Lite', $row['name']);
        $this->assertSame($server->uuid, $row['uuid']);
        $this->assertSame($server->memory, $row['limits']['memory']);
        $this->assertCount(1, $row['relationships']['allocations']['data']);
        $this->assertTrue($row['relationships']['allocations']['data'][0]['attributes']['is_default']);
        $this->assertNull($row['relationships']['allocations']['data'][0]['attributes']['notes']);
        $this->assertArrayNotHasKey('invocation', $row);
        $this->assertArrayNotHasKey('variables', $row['relationships'] ?? []);
    }

    public function testWithoutLiteTheCompleteRepresentationIsUnchanged(): void
    {
        $user = User::factory()->create();
        $this->createServerModel(['user_id' => $user->id]);

        $row = $this->actingAs($user)->getJson('/api/client')->assertOk()->json('data.0.attributes');

        $this->assertArrayHasKey('invocation', $row);
        $this->assertArrayHasKey('docker_image', $row);
    }
}
