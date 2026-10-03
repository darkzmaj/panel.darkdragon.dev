<?php

namespace Pterodactyl\Tests\Integration\Services\Templates;

use Pterodactyl\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Models\TemplateSftpCredential;
use Pterodactyl\Tests\Integration\Http\HttpTestCase;
use Pterodactyl\Services\Templates\TemplateSftpService;
use Pterodactyl\Tests\Traits\Integration\BuildsTemplates;
use Pterodactyl\Tests\Traits\Integration\RemovesAddedRows;

class TemplateSftpServiceTest extends HttpTestCase
{
    use BuildsTemplates;
    use RemovesAddedRows;

    private const TOKEN = 'a-very-long-shared-secret-for-the-sftp-service-0123456789';

    public function setUp(): void
    {
        parent::setUp();

        defined('LARAVEL_START') || define('LARAVEL_START', microtime(true));
        $this->useTemplateStorage();
        $this->rememberHighWater();
        config(['gobia_templates.sftp.service_token' => self::TOKEN]);
        RateLimiter::clear('template-sftp:ip:10.0.0.1');
    }

    public function tearDown(): void
    {
        $this->removeTemplateStorage();
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        DB::table('template_sftp_events')->where('id', '>', 0)->delete();
        DB::table('template_sftp_credentials')->where('id', '>', 0)->delete();
        DB::statement('SET FOREIGN_KEY_CHECKS=1');
        $this->removeAddedRows();
        parent::tearDown();
    }

    private function sftp(): TemplateSftpService
    {
        return app(TemplateSftpService::class);
    }

    public function testSecretsAreRandomShownOnceAndStoredHashed(): void
    {
        $template = $this->makeTemplate();
        [$a, $secretA] = $this->sftp()->create($template, null, 'rw', 30, 'deploys');
        [$b, $secretB] = $this->sftp()->create($template, null, 'ro', null, null);

        $this->assertSame(32, strlen($secretA));
        $this->assertNotSame($secretA, $secretB);
        $this->assertNotSame($a->username, $b->username);
        $this->assertStringStartsWith('tpl_', $a->username);
        $this->assertTrue(Hash::check($secretA, $a->password_hash));
        $this->assertStringNotContainsString($secretA, json_encode($a->fresh()->toArray()));
        $this->assertDatabaseMissing('template_sftp_credentials', ['password_hash' => $secretA]);
    }

    public function testALoginOpensExactlyItsTemplateWithItsPermission(): void
    {
        $one = $this->makeTemplate(['name' => 'One']);
        $two = $this->makeTemplate(['name' => 'Two']);
        [$cred, $secret] = $this->sftp()->create($one, null, 'ro', 10, null);
        $this->sftp()->create($two, null, 'rw', 10, null);

        $result = $this->sftp()->authenticate($cred->username, $secret, '10.0.0.1');

        $this->assertSame($one->uuid, $result['template']);
        $this->assertSame('ro', $result['permission']);
        $this->assertSame($cred->id, $result['credential']);
        $this->assertSame(['max_file_bytes', 'max_total_bytes', 'max_files'], array_keys($result['limits']));
        $this->assertNotNull($cred->refresh()->last_used_at);
        $this->assertSame('10.0.0.1', $cred->last_used_ip);
        $this->assertDatabaseHas('template_sftp_events', ['credential_id' => $cred->id, 'event' => 'login']);
    }

    public function testWrongRevokedAndExpiredCredentialsAreRefused(): void
    {
        $template = $this->makeTemplate();
        [$cred, $secret] = $this->sftp()->create($template, null, 'rw', 5, null);

        $this->assertNull($this->sftp()->authenticate($cred->username, 'wrong', '10.0.0.1'));
        $this->assertNull($this->sftp()->authenticate('tpl_unknownuser', $secret, '10.0.0.1'));
        $this->assertDatabaseHas('template_sftp_events', ['credential_id' => $cred->id, 'event' => 'login_failed']);

        $cred->forceFill(['expires_at' => now()->subMinute()])->save();
        $this->assertNull($this->sftp()->authenticate($cred->username, $secret, '10.0.0.2'));
        $this->assertSame('expired', $cred->refresh()->status());

        $cred->forceFill(['expires_at' => now()->addDay()])->save();
        $this->assertNotNull($this->sftp()->authenticate($cred->username, $secret, '10.0.0.3'));
        $this->sftp()->revoke($cred);
        $this->assertNull($this->sftp()->authenticate($cred->username, $secret, '10.0.0.4'));
        $this->assertSame('revoked', $cred->refresh()->status());
    }

    public function testRepeatedFailuresLockTheUsernameAndTheAddress(): void
    {
        $template = $this->makeTemplate();
        [$cred, $secret] = $this->sftp()->create($template, null, 'rw', 5, null);
        RateLimiter::clear('template-sftp:user:' . $cred->username);

        for ($i = 0; $i < TemplateSftpService::MAX_FAILURES_PER_USERNAME; ++$i) {
            $this->assertNull($this->sftp()->authenticate($cred->username, 'guess' . $i, '10.0.1.' . $i));
        }

        // Even the right password is refused while the username is locked, whatever the address.
        $this->assertNull($this->sftp()->authenticate($cred->username, $secret, '10.0.1.99'));
        $this->assertDatabaseHas('template_sftp_events', ['event' => 'rate_limited', 'username' => $cred->username]);

        RateLimiter::clear('template-sftp:user:' . $cred->username);
        for ($i = 0; $i < TemplateSftpService::MAX_FAILURES_PER_IP; ++$i) {
            $this->sftp()->authenticate('tpl_nobody' . $i, 'x', '10.9.9.9');
        }
        $this->assertNull($this->sftp()->authenticate($cred->username, $secret, '10.9.9.9'), 'one address cannot keep guessing');
    }

    public function testCredentialLimitsAreValidated(): void
    {
        $template = $this->makeTemplate();

        foreach ([['admin', 5], ['rw', 0], ['rw', 100000]] as [$permission, $days]) {
            try {
                $this->sftp()->create($template, null, $permission, $days, null);
                $this->fail("Expected a refusal for $permission/$days");
            } catch (DisplayException) {
                $this->addToAssertionCount(1);
            }
        }
        $this->assertSame(0, $template->sftpCredentials()->count());
    }

    public function testAFinishedSessionMarksTheWorkingTreeChanged(): void
    {
        $template = $this->makeTemplate();
        [$cred] = $this->sftp()->create($template, null, 'rw', 5, null);
        $this->assertNull($template->refresh()->working_changed_at);

        $this->sftp()->sessionEnded($cred->id, 0, 0, '10.0.0.1');
        $this->assertNull($template->refresh()->working_changed_at, 'a read only session changes nothing');

        $this->sftp()->sessionEnded($cred->id, 3, 4096, '10.0.0.1');
        $this->assertNotNull($template->refresh()->working_changed_at);
    }

    public function testTheInternalEndpointsNeedTheServiceToken(): void
    {
        $template = $this->makeTemplate();
        [$cred, $secret] = $this->sftp()->create($template, null, 'rw', 5, null);
        $body = ['username' => $cred->username, 'password' => $secret, 'ip' => '10.0.0.1'];

        $this->postJson('/api/internal/template-sftp/authenticate', $body)->assertForbidden();
        $this->postJson('/api/internal/template-sftp/authenticate', $body, ['Authorization' => 'Bearer wrong'])->assertForbidden();
        $this->postJson('/api/internal/template-sftp/authenticate', $body, ['Authorization' => 'Bearer ' . self::TOKEN])
            ->assertOk()->assertJsonPath('template', $template->uuid)->assertJsonPath('permission', 'rw');
        $this->postJson('/api/internal/template-sftp/authenticate', ['password' => 'x'] + $body, ['Authorization' => 'Bearer ' . self::TOKEN])
            ->assertStatus(401);
        $this->postJson('/api/internal/template-sftp/session', ['credential' => $cred->id, 'files_changed' => 2, 'bytes_written' => 10, 'ip' => '10.0.0.1'], ['Authorization' => 'Bearer ' . self::TOKEN])
            ->assertNoContent();

        // With no token configured (or a short, guessable one) the endpoints are closed completely.
        foreach (['', 'short'] as $configured) {
            config(['gobia_templates.sftp.service_token' => $configured]);
            $this->postJson('/api/internal/template-sftp/authenticate', $body, ['Authorization' => 'Bearer ' . $configured])->assertForbidden();
        }
    }

    public function testAdministratorsCreateAndRevokeCredentialsAndNeverSeeASecretAgain(): void
    {
        $admin = User::factory()->admin()->create();
        $template = $this->makeTemplate();
        $base = "/admin/templates/view/{$template->id}/sftp";

        $created = $this->actingAs($admin)->postJson($base, ['permission' => 'ro', 'expires_in_days' => 7, 'label' => 'ci'])->assertCreated();
        $secret = $created->json('password');
        $this->assertSame(32, strlen($secret));
        $created->assertJsonPath('permission', 'ro');

        $listing = $this->actingAs($admin)->getJson($base)->assertOk();
        $this->assertStringNotContainsString($secret, $listing->getContent());
        $this->assertStringNotContainsString('password_hash', $listing->getContent());
        $listing->assertJsonPath('credentials.0.status', 'active')->assertJsonPath('credentials.0.label', 'ci');

        $id = $created->json('id');
        $this->actingAs($admin)->deleteJson("$base/$id")->assertOk();
        $this->actingAs($admin)->getJson($base)->assertJsonPath('credentials.0.status', 'revoked');

        // Another template's credential cannot be revoked through this template.
        $other = $this->makeTemplate(['name' => 'Other']);
        [$foreign] = $this->sftp()->create($other, null, 'rw', 5, null);
        $this->actingAs($admin)->deleteJson("$base/{$foreign->id}")->assertNotFound();
        $this->assertTrue($foreign->refresh()->isActive());

        $this->actingAs(User::factory()->create())->getJson($base)->assertForbidden();
        $this->assertInstanceOf(TemplateSftpCredential::class, $foreign);
    }
}
