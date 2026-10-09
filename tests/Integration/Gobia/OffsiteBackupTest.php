<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\OffsiteBackupTest;

use DateTimeImmutable;
use DateTimeZone;
use GobiaBackups\Console\BackupCommand;
use GobiaBackups\Console\DestinationAddCommand;
use GobiaBackups\Console\PolicySetCommand;
use GobiaBackups\Models\Destination;
use GobiaBackups\Models\Policy;
use GobiaBackups\Models\Restore;
use GobiaBackups\Models\Run;
use GobiaBackups\Services\BackupService;
use GobiaBackups\Services\PolicyResolver;
use GobiaBackups\Services\Scheduler;
use GobiaBackups\Storage\RemoteStore;
use GobiaBackups\Storage\StorageBoxStore;
use GobiaBackups\Storage\StoreFactory;
use GobiaBackups\Support\StreamCipher;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Models\ApiKey;
use Pterodactyl\Models\Backup;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;
use RuntimeException;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class);

const ADMIN = '/api/admin/extensions/gobia-backups';
const FINGERPRINT = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** A Storage Box that is a folder on disk, so the whole flow runs without a network. */
function fakeBox(string $root): RemoteStore
{
    return new class($root) implements RemoteStore
    {
        /** Report this checksum instead of the real one, to prove a mismatch is caught. */
        public static ?string $lie = null;

        /** Whether the box can compute checksums (port 23) or not (port 22). */
        public static bool $checksums = true;

        public function __construct(private readonly string $root) {}

        public function fingerprint(): string
        {
            return FINGERPRINT;
        }

        public function makeDirectory(string $directory): void
        {
            File::ensureDirectoryExists($this->root.'/'.$directory);
        }

        public function put(string $path, callable $read): void
        {
            $handle = fopen($this->root.'/'.$path, 'wb');
            // 32 KiB at a time, like an SFTP packet: the caller must cope with small reads.
            while (($chunk = $read(32768)) !== null) {
                fwrite($handle, $chunk);
            }

            fclose($handle);
        }

        public function get(string $path, callable $write): void
        {
            $handle = fopen($this->root.'/'.$path, 'rb');
            while (! feof($handle)) {
                $write((string) fread($handle, 50000));
            }

            fclose($handle);
        }

        public function size(string $path): ?int
        {
            clearstatcache();

            return is_file($this->root.'/'.$path) ? (int) filesize($this->root.'/'.$path) : null;
        }

        public function sha256(string $path): ?string
        {
            return self::$checksums ? (self::$lie ?? (string) hash_file('sha256', $this->root.'/'.$path)) : null;
        }

        public function rename(string $from, string $to): void
        {
            rename($this->root.'/'.$from, $this->root.'/'.$to);
        }

        public function delete(string $path): void
        {
            @unlink($this->root.'/'.$path);
        }

        public function close(): void {}
    };
}

/** Wings, as far as backups are concerned: it "builds" an archive, serves it, restores from a link, deletes. */
function fakeWings(object $test): void
{
    $test->wingsCalls = [];
    $test->archive = random_bytes(200000).'the end';
    $test->restoreUrl = null;
    Http::fake(function (Request $request) use ($test) {
        $path = (string) parse_url($request->url(), PHP_URL_PATH);
        $test->wingsCalls[] = $request->method().' '.preg_replace('/[0-9a-f-]{36}/', '{uuid}', $path);
        if (str_ends_with($path, '/download/backup')) {
            return Http::response($test->archive, 200, ['Content-Type' => 'application/x-gzip']);
        }

        if (str_ends_with($path, '/restore')) {
            $test->restoreUrl = $request->data()['download_url'] ?? null;
            $test->restoreAdapter = $request->data()['adapter'] ?? null;
        }

        return Http::response('', 204);
    });
}

function destination(array $attributes = []): Destination
{
    return Destination::query()->create($attributes + [
        'name' => 'box-'.uniqid(), 'host' => 'u1.your-storagebox.de', 'port' => 23, 'username' => 'u1-sub1', 'private_key' => "-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----",
        'host_key_fingerprint' => FINGERPRINT, 'base_path' => 'gobia-backups', 'encrypt' => true, 'encryption_key' => base64_encode(StreamCipher::generateKey()), 'enabled' => true,
    ]);
}

/** What Wings does when the archive is ready: report it to the Panel, which is what moves a run on. */
function wingsReports(object $test, Run $run, bool $successful = true, ?string $bytes = null): void
{
    $backup = Backup::query()->where('uuid', $run->backup_uuid)->firstOrFail();
    $bytes ??= $test->archive;
    $backup->forceFill(['is_successful' => $successful, 'checksum' => $successful ? 'sha1:'.sha1($bytes) : null, 'bytes' => $successful ? mb_strlen($bytes, '8bit') : 0, 'completed_at' => now()])->save();
    resolve(BackupService::class)->archiveFinished($run->server_uuid, $backup->uuid, $successful);
}

/** One complete backup of a server: queue, start, archive ready, upload. */
function backUp(object $test, Server $server): Run
{
    $run = resolve(BackupService::class)->request($server, Run::TRIGGER_MANUAL);
    resolve(Scheduler::class)->tick();
    wingsReports($test, $run->refresh());

    return $run->refresh();
}

beforeEach(function (): void {
    $this->installGobia(['gobia-backups']);
    $this->box = sys_get_temp_dir().'/gobia-box-'.uniqid();
    File::ensureDirectoryExists($this->box);
    $box = $this->box;
    $this->app->instance(StoreFactory::class, new class($box) extends StoreFactory
    {
        public function __construct(private readonly string $root) {}

        public function open(Destination $destination): RemoteStore
        {
            return fakeBox($this->root);
        }

        public function probe(Destination $destination): RemoteStore
        {
            return fakeBox($this->root);
        }
    });
    fakeWings($this);
    fakeBox($box)::$lie = null;
    fakeBox($box)::$checksums = true;

    [$this->owner, $this->server] = $this->generateTestAccount();
    $this->destination = destination();
    Policy::query()->create(['scope' => Policy::SCOPE_GLOBAL, 'destination_id' => $this->destination->id]);
});

afterEach(function (): void {
    File::deleteDirectory($this->box);
    $this->uninstallGobia();
});

test('the stream cipher round trips every size and refuses truncated, altered and wrongly keyed data', function (): void {
    $key = StreamCipher::generateKey();
    foreach ([0, 1, 100, StreamCipher::CHUNK - 1, StreamCipher::CHUNK, StreamCipher::CHUNK + 1, 3 * StreamCipher::CHUNK, 3 * StreamCipher::CHUNK + 7] as $size) {
        $plain = $size === 0 ? '' : random_bytes($size);
        $encryptor = StreamCipher::encryptor($key);
        $cipher = '';
        foreach ($size === 0 ? [''] : mb_str_split($plain, 30011) as $piece) {
            $cipher .= $encryptor->update($piece);
        }

        $cipher .= $encryptor->finish();
        expect(mb_strlen($cipher, '8bit'))->toBe(StreamCipher::encryptedSize($size));

        $decryptor = StreamCipher::decryptor($key);
        $back = '';
        foreach (mb_str_split($cipher, 40009) as $piece) {
            $back .= $decryptor->update($piece);
        }

        expect($back.$decryptor->finish())->toBe($plain);
    }

    $encryptor = StreamCipher::encryptor($key);
    $cipher = $encryptor->update(random_bytes(150000)).$encryptor->finish();
    $decrypt = function (string $data, string $with): string {
        $decryptor = StreamCipher::decryptor($with);

        return $decryptor->update($data).$decryptor->finish();
    };

    // Cut at a frame boundary: without the FINAL tag this would look like a complete, shorter archive.
    expect(fn (): string => $decrypt(mb_strcut($cipher, 0, 32 + StreamCipher::CHUNK + 17, '8bit'), $key))->toThrow(RuntimeException::class);
    expect(fn (): string => $decrypt(mb_strcut($cipher, 0, mb_strlen($cipher, '8bit') - 5, '8bit'), $key))->toThrow(RuntimeException::class);

    $altered = $cipher;
    $altered[5000] = $altered[5000] === 'a' ? 'b' : 'a';
    expect(fn (): string => $decrypt($altered, $key))->toThrow(RuntimeException::class);
    expect(fn (): string => $decrypt($cipher, StreamCipher::generateKey()))->toThrow(RuntimeException::class);
    expect(fn (): string => $decrypt($cipher.'extra', $key))->toThrow(RuntimeException::class);
    expect(fn (): string => $decrypt('plain tar.gz bytes that were never encrypted, long enough to hold a header', $key))->toThrow(RuntimeException::class);
});

test('a host key fingerprint is the OpenSSH one', function (): void {
    // ssh-keygen -lf on this public key prints SHA256:bLAUh1j3pYEXUvJrdK9vkZKdYfc2FNmCYSCAkcA9rlM.
    $blob = base64_encode(str_repeat("\x01", 51));
    expect(StorageBoxStore::fingerprintOf('ssh-ed25519 '.$blob.' comment'))->toBe('SHA256:'.mb_rtrim(base64_encode(hash('sha256', str_repeat("\x01", 51), true)), '='));
    expect(fn () => StorageBoxStore::fingerprintOf('not a key'))->toThrow(RuntimeException::class);
});

test('destinations and policies are for administrators and credentials need a session', function (): void {
    foreach (['destinations', 'policies', 'runs', 'restores'] as $path) {
        $this->getJson(ADMIN.'/'.$path)->assertUnauthorized();
    }

    $this->actingAs($this->owner);
    $this->getJson(ADMIN.'/destinations')->assertForbidden();
    $this->postJson(ADMIN.'/destinations', [])->assertForbidden();
    $this->putJson(ADMIN.'/policies', ['scope' => 'global', 'enabled' => true])->assertForbidden();
    $this->postJson(ADMIN.'/servers/'.$this->server->uuid.'/backups')->assertForbidden();

    $admin = User::factory()->create(['root_admin' => true]);
    $key = ApiKey::factory()->for($admin)->create(['key_type' => ApiKey::TYPE_ACCOUNT]);
    $headers = ['Authorization' => 'Bearer '.$key->identifier.decrypt($key->token)];
    $this->app['auth']->forgetGuards();
    $this->withHeaders($headers)->getJson(ADMIN.'/destinations')->assertOk();
    $this->withHeaders($headers)->postJson(ADMIN.'/destinations', ['name' => 'x'])->assertForbidden();
    $this->withHeaders($headers)->deleteJson(ADMIN.'/destinations/'.$this->destination->id)->assertForbidden();
    $this->withHeaders($headers)->postJson(ADMIN.'/runs/'.fake()->uuid().'/restore', ['password' => 'x'])->assertForbidden();
});

test('a destination is validated, its key is shown once and its secrets never come back', function (): void {
    $this->actingAs(User::factory()->create(['root_admin' => true]));
    $valid = ['name' => 'Falkenstein', 'host' => 'u123.your-storagebox.de', 'username' => 'u123-sub1', 'private_key' => "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret-key-material\n-----END OPENSSH PRIVATE KEY-----", 'host_key_fingerprint' => FINGERPRINT];

    foreach ([
        ['host' => 'u123.your-storagebox.de/../../etc'], ['host' => '-oProxyCommand=id'], ['host' => 'user@host'], ['username' => 'root; id'],
        ['host_key_fingerprint' => 'trust-me'], ['base_path' => '../outside'], ['base_path' => '/etc'], ['private_key' => 'not a key'],
    ] as $bad) {
        $this->postJson(ADMIN.'/destinations', array_merge($valid, $bad))->assertUnprocessable();
    }

    $this->postJson(ADMIN.'/destinations', array_diff_key($valid, ['private_key' => 1]))->assertUnprocessable();

    $created = $this->postJson(ADMIN.'/destinations', $valid)->assertCreated()->json();
    expect($created['port'])->toBe(23);
    expect($created['encrypt'])->toBeTrue();
    expect(mb_strlen((string) base64_decode((string) $created['encryption_key'], true), '8bit'))->toBe(StreamCipher::KEY_BYTES);
    expect($created)->not->toHaveKey('private_key');

    $listed = $this->getJson(ADMIN.'/destinations')->assertOk()->getContent();
    expect($listed)->not->toContain('secret-key-material')->not->toContain($created['encryption_key'])->toContain('"has_private_key":true');
    // At rest the key is encrypted with the Panel key, not stored as given.
    expect((string) DB::table('gobia_backup_destinations')->where('id', $created['id'])->value('private_key'))->not->toContain('secret-key-material');

    // Another host needs its own pinned key.
    $this->patchJson(ADMIN.'/destinations/'.$created['id'], ['host' => 'u999.your-storagebox.de'])->assertUnprocessable();
    $this->patchJson(ADMIN.'/destinations/'.$created['id'], ['enabled' => false])->assertOk()->assertJsonPath('enabled', false)->assertJsonPath('has_private_key', true);

    $this->postJson(ADMIN.'/destinations/'.$created['id'].'/test')->assertOk()->assertJson(['ok' => true, 'checksum_supported' => true]);
    $this->postJson(ADMIN.'/destinations/probe', ['host' => 'u123.your-storagebox.de'])->assertOk()->assertJsonPath('host_key_fingerprint', FINGERPRINT);
    $this->deleteJson(ADMIN.'/destinations/'.$created['id'])->assertNoContent();
});

test('a server level overrides its node, which overrides the global level, and schedules respect timezone and window', function (): void {
    $resolver = resolve(PolicyResolver::class);
    $other = destination();
    expect($resolver->effective($this->server))->toMatchArray(['destination_id' => $this->destination->id, 'enabled' => false, 'keep_last' => 7, 'cron' => '0 4 * * *']);

    $this->actingAs(User::factory()->create(['root_admin' => true]));
    $this->putJson(ADMIN.'/policies', ['scope' => 'global', 'destination_id' => $this->destination->id, 'enabled' => true, 'keep_last' => 5])->assertOk();
    $this->putJson(ADMIN.'/policies', ['scope' => 'node', 'node_id' => $this->server->node_id, 'keep_last' => 3, 'cron' => '30 2 * * *', 'timezone' => 'Europe/Ljubljana'])->assertOk();
    $this->putJson(ADMIN.'/policies', ['scope' => 'server', 'server' => $this->server->uuid, 'destination_id' => $other->id, 'ignored' => ['cache/', '*.log']])->assertOk();

    $effective = $this->getJson(ADMIN.'/servers/'.$this->server->uuid.'/policy')->assertOk()->json();
    expect($effective)->toMatchArray(['destination_id' => $other->id, 'enabled' => true, 'keep_last' => 3, 'cron' => '30 2 * * *', 'timezone' => 'Europe/Ljubljana', 'ignored' => ['cache/', '*.log']]);

    // 02:30 in Ljubljana is 00:30 UTC in summer.
    $at = fn (string $utc): DateTimeImmutable => new DateTimeImmutable($utc, new DateTimeZone('UTC'));
    expect($resolver->isDue($effective, $at('2026-07-01 00:30:00')))->toBeTrue();
    expect($resolver->isDue($effective, $at('2026-07-01 02:30:00')))->toBeFalse();
    // A window that crosses midnight: 22:00 to 04:00.
    $windowed = ['cron' => '* * * * *', 'timezone' => 'UTC', 'window_start' => 22 * 60, 'window_end' => 4 * 60];
    expect($resolver->isDue($windowed, $at('2026-07-01 23:15:00')))->toBeTrue();
    expect($resolver->isDue($windowed, $at('2026-07-01 03:59:00')))->toBeTrue();
    expect($resolver->isDue($windowed, $at('2026-07-01 12:00:00')))->toBeFalse();

    $this->putJson(ADMIN.'/policies', ['scope' => 'global', 'cron' => 'every day'])->assertUnprocessable();
    $this->putJson(ADMIN.'/policies', ['scope' => 'global', 'window_start' => 60])->assertUnprocessable();
    $this->putJson(ADMIN.'/policies', ['scope' => 'global', 'destination_id' => 999999])->assertUnprocessable();
    $this->deleteJson(ADMIN.'/policies', ['scope' => 'server', 'server' => $this->server->uuid])->assertNoContent();
    expect($this->getJson(ADMIN.'/servers/'.$this->server->uuid.'/policy')->json('destination_id'))->toBe($this->destination->id);
});

test('a backup is built by Wings, stored encrypted and verified, and the copy on the node is removed', function (): void {
    $run = resolve(BackupService::class)->request($this->server, Run::TRIGGER_MANUAL, $this->owner);
    expect($run->state)->toBe(Run::QUEUED);
    expect(fn () => resolve(BackupService::class)->request($this->server, Run::TRIGGER_MANUAL))->toThrow(DisplayException::class);

    resolve(Scheduler::class)->tick();
    $run->refresh();
    expect($run->state)->toBe(Run::ARCHIVING);
    $backup = Backup::query()->where('uuid', $run->backup_uuid)->firstOrFail();
    expect($backup->disk)->toBe('wings');
    expect($backup->is_locked)->toBeTrue();
    expect($this->wingsCalls)->toContain('POST /api/servers/{uuid}/backup');

    wingsReports($this, $run);
    $run->refresh();
    expect($run->state)->toBe(Run::COMPLETED);
    expect($run->error)->toBeNull();
    expect($run->bytes)->toBe(mb_strlen($this->archive, '8bit'));
    expect($run->archive_sha256)->toBe(hash('sha256', $this->archive));
    expect($run->verified_by)->toBe('sha256');
    expect($run->encrypted)->toBeTrue();

    $stored = (string) file_get_contents($this->box.'/'.$run->remote_path);
    expect($run->remote_path)->toBe($this->server->uuid.'/'.$run->uuid.'.tar.gz.gbk');
    expect(mb_strlen($stored, '8bit'))->toBe(StreamCipher::encryptedSize($run->bytes))->toBe($run->stored_bytes);
    expect(str_contains($stored, 'the end'))->toBeFalse();
    expect(File::allFiles($this->box))->toHaveCount(1);

    $decryptor = StreamCipher::decryptor((string) base64_decode((string) $this->destination->encryption_key, true));
    expect($decryptor->update($stored).$decryptor->finish())->toBe($this->archive);

    // The archive on the node and the Panel backup that only existed to build it are gone: no limit or throttle is used up.
    expect($this->wingsCalls)->toContain('DELETE /api/servers/{uuid}/backup/{uuid}');
    expect(Backup::withTrashed()->where('uuid', $backup->uuid)->exists())->toBeFalse();
});

test('an archive that arrives damaged, or is stored wrongly, is not kept and the run is tried again', function (): void {
    $run = resolve(BackupService::class)->request($this->server, Run::TRIGGER_MANUAL);
    resolve(Scheduler::class)->tick();
    // Wings reports the checksum of other bytes than the node then serves.
    wingsReports($this, $run->refresh(), bytes: str_repeat('x', mb_strlen($this->archive, '8bit')));

    $run->refresh();
    expect($run->state)->toBe(Run::QUEUED);
    expect($run->error)->toContain('checksum');
    expect($run->retry_at)->not->toBeNull();
    expect(File::allFiles($this->box))->toHaveCount(0);

    // Not before the wait is over.
    resolve(Scheduler::class)->tick();
    expect($run->refresh()->state)->toBe(Run::QUEUED);

    $run->forceFill(['retry_at' => now()->subMinute()])->save();
    resolve(Scheduler::class)->tick();
    fakeBox($this->box)::$lie = str_repeat('0', 64);
    wingsReports($this, $run->refresh());
    expect($run->refresh()->error)->toContain('SHA-256');
    expect(File::allFiles($this->box))->toHaveCount(0);

    // The third attempt is the last one.
    $run->forceFill(['retry_at' => now()->subMinute()])->save();
    resolve(Scheduler::class)->tick();
    wingsReports($this, $run->refresh(), successful: false);
    expect($run->refresh()->state)->toBe(Run::FAILED);
    expect($run->attempts)->toBe(3);
    expect(Backup::withTrashed()->where('server_id', $this->server->id)->count())->toBe(0);
});

test('without a checksum from the box the size is verified, and an unencrypted destination stores the plain archive', function (): void {
    fakeBox($this->box)::$checksums = false;
    $this->destination->forceFill(['encrypt' => false, 'encryption_key' => null])->save();

    $run = backUp($this, $this->server);
    expect($run->state)->toBe(Run::COMPLETED);
    expect($run->verified_by)->toBe('size');
    expect($run->encrypted)->toBeFalse();
    expect(file_get_contents($this->box.'/'.$this->server->uuid.'/'.$run->uuid.'.tar.gz'))->toBe($this->archive);
});

test('retention keeps the newest backups and never the last one away', function (): void {
    Policy::query()->where('scope', Policy::SCOPE_GLOBAL)->update(['keep_last' => 2]);
    $runs = [];
    foreach (range(1, 4) as $index) {
        $runs[] = backUp($this, $this->server);
        $this->travel(1)->hours();
    }

    expect(array_map(fn (Run $run): string => $run->refresh()->state, $runs))->toBe([Run::DELETED, Run::DELETED, Run::COMPLETED, Run::COMPLETED]);
    expect(File::allFiles($this->box))->toHaveCount(2);

    // Age alone never removes the only backups a server has left.
    Policy::query()->where('scope', Policy::SCOPE_GLOBAL)->update(['keep_last' => 5, 'keep_days' => 1]);
    $this->travel(10)->days();
    $latest = backUp($this, $this->server);
    expect($latest->state)->toBe(Run::COMPLETED);
    expect(Run::query()->where('state', Run::COMPLETED)->pluck('id')->all())->toBe([$latest->id]);
});

test('only so many backups run at once per node', function (): void {
    config(['gobia_backups.concurrency.per_node' => 1]);
    $second = $this->createServerModel(['node_id' => $this->server->node_id]);
    $elsewhere = $this->createServerModel();
    $a = resolve(BackupService::class)->request($this->server, Run::TRIGGER_MANUAL);
    $b = resolve(BackupService::class)->request($second, Run::TRIGGER_MANUAL);
    $c = resolve(BackupService::class)->request($elsewhere, Run::TRIGGER_MANUAL);

    resolve(Scheduler::class)->tick();
    expect([$a->refresh()->state, $b->refresh()->state, $c->refresh()->state])->toBe([Run::ARCHIVING, Run::QUEUED, Run::ARCHIVING]);

    wingsReports($this, $a);
    resolve(Scheduler::class)->tick();
    expect($b->refresh()->state)->toBe(Run::ARCHIVING);
});

test('the schedule queues a backup when it fires and a stuck run is given up', function (): void {
    Policy::query()->where('scope', Policy::SCOPE_GLOBAL)->update(['enabled' => true, 'cron' => '0 4 * * *', 'timezone' => 'UTC']);
    $scheduler = resolve(Scheduler::class);

    expect($scheduler->tick(new DateTimeImmutable('2026-07-01 03:59:00 UTC'))['queued'])->toBe(0);
    $result = $scheduler->tick(new DateTimeImmutable('2026-07-01 04:00:00 UTC'));
    expect($result['queued'])->toBeGreaterThanOrEqual(1);
    $run = Run::query()->where('server_uuid', $this->server->uuid)->firstOrFail();
    expect([$run->trigger, $run->state])->toBe([Run::TRIGGER_SCHEDULE, Run::ARCHIVING]);
    // The same minute again does not queue a second one.
    $scheduler->tick(new DateTimeImmutable('2026-07-01 04:00:30 UTC'));
    expect(Run::query()->where('server_uuid', $this->server->uuid)->count())->toBe(1);

    $run->forceFill(['heartbeat_at' => now()->subDay()])->save();
    $scheduler->tick(new DateTimeImmutable('2026-07-01 12:00:00 UTC'));
    expect($run->refresh()->error)->toContain('in time');
});

test('with mirroring on, a backup someone made in the Panel is copied too and stays on the node', function (): void {
    $backup = Backup::factory()->create(['server_id' => $this->server->id, 'disk' => 'wings', 'is_successful' => true, 'checksum' => 'sha1:'.sha1($this->archive), 'bytes' => mb_strlen($this->archive, '8bit'), 'completed_at' => now()]);

    resolve(BackupService::class)->archiveFinished($this->server->uuid, $backup->uuid, true);
    expect(Run::query()->count())->toBe(0);

    Policy::query()->where('scope', Policy::SCOPE_GLOBAL)->update(['mirror_user_backups' => true]);
    resolve(PolicyResolver::class)->forget();
    resolve(BackupService::class)->archiveFinished($this->server->uuid, $backup->uuid, true);

    $run = Run::query()->firstOrFail();
    expect([$run->trigger, $run->state, $run->keep_local])->toBe([Run::TRIGGER_MIRROR, Run::COMPLETED, true]);
    expect(Backup::query()->where('uuid', $backup->uuid)->exists())->toBeTrue();
    expect($this->wingsCalls)->not->toContain('DELETE /api/servers/{uuid}/backup/{uuid}');
});

test('people with access see and start backups of their server, and nothing about where they are kept', function (): void {
    $url = '/api/client/servers/'.$this->server->uuid.'/extensions/gobia-backups/backups';
    $run = backUp($this, $this->server);

    $this->actingAs(User::factory()->create())->getJson($url)->assertNotFound();

    $body = $this->actingAs($this->owner)->getJson($url)->assertOk()->json();
    expect($body['configured'])->toBeTrue();
    expect($body['data'][0])->toMatchArray(['id' => $run->uuid, 'state' => 'completed', 'encrypted' => true]);
    expect(json_encode($body))->not->toContain('storagebox')->not->toContain('destination')->not->toContain($run->remote_path)->not->toContain('sha256');

    [$reader] = [$this->generateTestAccount(['websocket.connect', 'backup.read'])];
    [$subuser, $shared] = $reader;
    $shared->update(['node_id' => $this->server->node_id]);
    $base = '/api/client/servers/'.$shared->uuid.'/extensions/gobia-backups/backups';
    $this->actingAs($subuser)->getJson($base)->assertOk();
    $this->actingAs($subuser)->postJson($base)->assertForbidden();
    $this->actingAs($subuser)->postJson($base.'/'.$run->uuid.'/restore', ['password' => 'password'])->assertForbidden();

    [$operator, $operated] = $this->generateTestAccount(['websocket.connect', 'backup.read', 'ext.gobia-backups.create']);
    $this->actingAs($operator)->postJson('/api/client/servers/'.$operated->uuid.'/extensions/gobia-backups/backups')->assertStatus(202)->assertJsonPath('state', 'queued');
    $this->actingAs($operator)->postJson('/api/client/servers/'.$operated->uuid.'/extensions/gobia-backups/backups')->assertStatus(400);
});

test('a restore asks for the password, hands Wings a signed link and streams the decrypted archive through it', function (): void {
    $run = backUp($this, $this->server);
    $this->owner->forceFill(['password' => Hash::make('correct-horse-battery')])->save();
    $url = '/api/client/servers/'.$this->server->uuid.'/extensions/gobia-backups/backups/'.$run->uuid.'/restore';
    $this->actingAs($this->owner);

    $this->postJson($url, [])->assertUnprocessable();
    $this->postJson($url, ['password' => 'wrong'])->assertStatus(400);
    expect(Restore::query()->count())->toBe(0);

    // A backup of another server cannot be restored here by its owner.
    $foreign = backUp($this, $this->createServerModel());
    $this->postJson('/api/client/servers/'.$this->server->uuid.'/extensions/gobia-backups/backups/'.$foreign->uuid.'/restore', ['password' => 'correct-horse-battery'])->assertNotFound();

    $restore = $this->postJson($url, ['password' => 'correct-horse-battery', 'truncate' => true])->assertStatus(202)->assertJsonPath('state', 'requested')->json();
    expect($this->server->refresh()->status)->toBe(Server::STATUS_RESTORING_BACKUP);
    expect($this->restoreAdapter)->toBe('s3');
    expect($this->restoreUrl)->toContain('/extensions/gobia-backups/fetch/'.$restore['id'])->toContain('signature=');
    $this->postJson($url, ['password' => 'correct-horse-battery'])->assertStatus(409);

    // What Wings does next: fetch the link, with no session at all.
    $this->app['auth']->forgetGuards();
    $path = parse_url($this->restoreUrl, PHP_URL_PATH).'?'.parse_url($this->restoreUrl, PHP_URL_QUERY);
    $this->get(str_replace('signature=', 'signature=0', $path))->assertForbidden();
    $this->get('/extensions/gobia-backups/fetch/'.$restore['id'])->assertForbidden();

    $response = $this->get($path)->assertOk()->assertHeader('Content-Type', 'application/x-gzip');
    expect($response->streamedContent())->toBe($this->archive);
    $model = Restore::query()->where('uuid', $restore['id'])->firstOrFail();
    expect([$model->state, $model->transferred_bytes])->toBe([Restore::UNPACKING, mb_strlen($this->archive, '8bit')]);
    // The link answers once: after the archive was handed over it is closed.
    $this->get($path)->assertNotFound();

    // Wings reports the end of the restore to the Panel, as it does for every restore.
    $node = $this->server->node;
    $this->withHeader('Authorization', "Bearer {$node->daemon_token_id}.".$node->getDecryptedKey())
        ->postJson('/api/remote/backups/'.$model->backup_uuid.'/restore', ['successful' => true])->assertNoContent();
    expect($this->server->refresh()->status)->toBeNull();

    resolve(Scheduler::class)->tick();
    expect($model->refresh()->state)->toBe(Restore::COMPLETED);
    expect(Backup::withTrashed()->where('uuid', $model->backup_uuid)->exists())->toBeFalse();
});

test('an administrator can restore a backup into another server, also when the original is gone', function (): void {
    $run = backUp($this, $this->server);
    $target = $this->createServerModel();
    $admin = User::factory()->create(['root_admin' => true, 'password' => Hash::make('admin-password-1')]);
    $this->actingAs($admin);

    $this->server->delete();
    expect($run->refresh()->server_id)->toBeNull();
    $this->getJson(ADMIN.'/runs')->assertOk()->assertJsonPath('data.0.server.exists', false)->assertJsonPath('data.0.server.uuid', $run->server_uuid);

    $this->postJson(ADMIN.'/runs/'.$run->uuid.'/restore', ['password' => 'admin-password-1'])->assertNotFound();
    $this->postJson(ADMIN.'/runs/'.$run->uuid.'/restore', ['target' => $target->uuid, 'password' => 'nope'])->assertStatus(400);
    $this->postJson(ADMIN.'/runs/'.$run->uuid.'/restore', ['target' => $target->uuid, 'password' => 'admin-password-1'])->assertStatus(202);
    expect($target->refresh()->status)->toBe(Server::STATUS_RESTORING_BACKUP);

    // Wings reports a failure: the restore is closed as failed and the server is usable again.
    $restore = Restore::query()->firstOrFail();
    $node = $target->node;
    $this->app['auth']->forgetGuards();
    $this->withHeader('Authorization', "Bearer {$node->daemon_token_id}.".$node->getDecryptedKey())
        ->postJson('/api/remote/backups/'.$restore->backup_uuid.'/restore', ['successful' => false])->assertNoContent();
    resolve(Scheduler::class)->tick();
    expect($restore->refresh()->state)->toBe(Restore::FAILED);
    expect($target->refresh()->status)->toBeNull();

    $this->flushHeaders()->actingAs($admin)->deleteJson(ADMIN.'/runs/'.$run->uuid)->assertNoContent();
    expect(File::allFiles($this->box))->toHaveCount(0);
    expect($run->refresh()->state)->toBe(Run::DELETED);
});

test('the console commands set a destination up, pin its host key and configure the schedule', function (): void {
    // Extension commands reach Artisan when the console starts; in a test the extension is installed after that.
    foreach ([DestinationAddCommand::class, PolicySetCommand::class, BackupCommand::class] as $command) {
        $this->app->make(Kernel::class)->registerCommand(resolve($command));
    }

    $keyFile = $this->box.'/id_ed25519';
    file_put_contents($keyFile, "-----BEGIN OPENSSH PRIVATE KEY-----\nconsole-key\n-----END OPENSSH PRIVATE KEY-----\n");

    // A fingerprint other than the one the server presents saves nothing.
    $this->artisan('gobia-backups:destination:add', ['name' => 'cli-box', 'host' => 'u9.your-storagebox.de', 'username' => 'u9', '--key' => $keyFile, '--fingerprint' => 'SHA256:'.str_repeat('B', 43)])->assertFailed();
    expect(Destination::query()->where('name', 'cli-box')->exists())->toBeFalse();

    $this->artisan('gobia-backups:destination:add', ['name' => 'cli-box', 'host' => 'u9.your-storagebox.de', 'username' => 'u9', '--key' => $keyFile, '--default' => true])
        ->expectsConfirmation('Is it the same?', 'yes')
        ->expectsOutputToContain('Encryption key')
        ->assertSuccessful();
    $created = Destination::query()->where('name', 'cli-box')->firstOrFail();
    expect([$created->host_key_fingerprint, $created->encrypt, $created->port])->toBe([FINGERPRINT, true, 23]);
    expect(Policy::query()->where('scope', Policy::SCOPE_GLOBAL)->value('destination_id'))->toBe($created->id);

    $this->artisan('gobia-backups:policy:set', ['--enable' => true, '--cron' => '15 3 * * *', '--keep-last' => 10, '--mirror' => 'yes'])->assertSuccessful();
    $this->artisan('gobia-backups:policy:set', ['--cron' => 'whenever'])->assertFailed();
    $this->artisan('gobia-backups:policy:set', ['--server' => $this->server->uuid, '--disable' => true])->assertSuccessful();
    resolve(PolicyResolver::class)->forget();
    expect(resolve(PolicyResolver::class)->effective($this->server))->toMatchArray(['enabled' => false, 'cron' => '15 3 * * *', 'keep_last' => 10, 'mirror_user_backups' => true]);

    $this->artisan('gobia-backups:run', ['server' => $this->server->uuid])->assertSuccessful();
    expect(Run::query()->where('server_uuid', $this->server->uuid)->value('state'))->toBe(Run::ARCHIVING);
    $this->artisan('gobia-backups:run', ['--list' => true])->assertSuccessful();
});
