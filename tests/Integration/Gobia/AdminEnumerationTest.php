<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\AdminEnumerationTest;

use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;

uses(ClientApiIntegrationTestCase::class);

test('someone who is not an administrator cannot tell which ids exist behind the admin and application APIs', function (): void {
    $existing = User::factory()->create();
    $this->actingAs(User::factory()->create());

    foreach (['/api/admin/users/', '/api/application/users/'] as $prefix) {
        $this->getJson($prefix.$existing->id)->assertForbidden();
        $this->getJson($prefix.'99999999')->assertForbidden();
    }

    $this->getJson('/api/admin/nodes/99999999')->assertForbidden();
    $this->getJson('/api/admin/servers/99999999')->assertForbidden();
});

test('an administrator still gets a plain not found for an id that does not exist', function (): void {
    $this->actingAs(User::factory()->create(['root_admin' => true]));

    $this->getJson('/api/admin/users/99999999')->assertNotFound();
});
