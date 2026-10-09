<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\FileTransferTest;

use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Pterodactyl\Models\Subuser;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class);

const TRANSFERS = '/api/client/extensions/gobia-files/transfers';

/** A tiny in-memory Wings: one file tree per server uuid, enough of the file API for the transfer service. */
final class FakeWings
{
    /** @var array<string, array<string, array{dir: bool, content: string}>> */
    public array $trees = [];

    /** Truncate what is stored for any file written with this name, to prove an integrity failure is caught. */
    public ?string $corrupt = null;

    /** Delete requests for a path containing this text fail with a 500, to prove a move never reports success then. */
    public ?string $failDelete = null;

    /** @var list<string> */
    public array $calls = [];

    public function seed(string $uuid, string $path, ?string $content): void
    {
        $this->trees[$uuid][$path] = ['dir' => $content === null, 'content' => $content ?? ''];
    }

    public function install(): void
    {
        Http::fake(function (Request $request) {
            if (! preg_match('#/api/servers/([0-9a-f-]{36})/files/([a-z-]+)#', $request->url(), $m)) {
                return Http::response('', 204);
            }

            [, $uuid, $action] = $m;
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
            $json = $request->data();
            $this->calls[] = "{$request->method()} {$action}";
            $tree = &$this->trees[$uuid];
            $tree ??= [];

            switch ($action) {
                case 'list-directory':
                    $directory = mb_rtrim((string) ($query['directory'] ?? '/'), '/');
                    $rows = [];
                    foreach ($tree as $path => $node) {
                        if ($this->parent($path) === ($directory === '' ? '/' : $directory) && $path !== '/') {
                            $rows[] = [
                                'name' => mb_substr($path, mb_strrpos($path, '/') + 1), 'mode' => '-rw-r--r--', 'mode_bits' => '644', 'size' => $node['dir'] ? 4096 : mb_strlen($node['content'], '8bit'),
                                'file' => ! $node['dir'], 'symlink' => false, 'mime' => 'text/plain', 'created' => '2026-01-01T00:00:00+00:00', 'modified' => '2026-01-01T00:00:00+00:00',
                            ];
                        }
                    }

                    return Http::response($rows);
                case 'contents':
                    $node = $tree[(string) $query['file']] ?? null;

                    return $node === null || $node['dir'] ? Http::response('', 404) : Http::response($node['content'], 200, ['Content-Length' => (string) mb_strlen($node['content'], '8bit')]);
                case 'write':
                    $content = $request->body();
                    $file = (string) $query['file'];
                    $tree[$file] = ['dir' => false, 'content' => $this->corrupt !== null && str_contains($file, $this->corrupt) ? mb_strcut($content, 0, max(0, mb_strlen($content, '8bit') - 1), '8bit') : $content];

                    return Http::response('', 204);
                case 'create-directory':
                    $tree[mb_rtrim((string) $json['path'], '/').'/'.$json['name']] = ['dir' => true, 'content' => ''];

                    return Http::response('', 204);
                case 'rename':
                    foreach ($json['files'] as $file) {
                        $from = mb_rtrim((string) $json['root'], '/').'/'.$file['from'];
                        $to = mb_rtrim((string) $json['root'], '/').'/'.$file['to'];
                        foreach ($tree as $path => $node) {
                            if ($path === $from || str_starts_with($path, $from.'/')) {
                                $tree[$to.mb_substr($path, mb_strlen($from))] = $node;
                                unset($tree[$path]);
                            }
                        }
                    }

                    return Http::response('', 204);
                case 'delete':
                    if ($this->failDelete !== null && str_contains(implode(',', $json['files']), $this->failDelete) && ! str_contains(implode(',', $json['files']), '.gobia-transfer-')) {
                        return Http::response('', 500);
                    }

                    foreach ($json['files'] as $name) {
                        $target = mb_rtrim((string) $json['root'], '/').'/'.$name;
                        foreach (array_keys($tree) as $path) {
                            if ($path === $target || str_starts_with($path, $target.'/')) {
                                unset($tree[$path]);
                            }
                        }
                    }

                    return Http::response('', 204);
            }

            return Http::response('', 204);
        });
    }

    /** @return list<string> */
    public function paths(string $uuid): array
    {
        $paths = array_keys($this->trees[$uuid] ?? []);
        sort($paths);

        return $paths;
    }

    private function parent(string $path): string
    {
        $cut = mb_strrpos($path, '/');

        return $cut === false || $cut === 0 ? '/' : mb_substr($path, 0, $cut);
    }
}

beforeEach(function (): void {
    $this->installGobia(['gobia-files']);
    $this->wings = new FakeWings;
    $this->wings->install();

    $this->owner = User::factory()->create();
    $this->a = $this->createServerModel(['owner_id' => $this->owner->id, 'name' => 'A']);
    $this->b = $this->createServerModel(['owner_id' => $this->owner->id, 'name' => 'B']);
});
afterEach(fn () => $this->uninstallGobia());

function send(array $overrides = [])
{
    return test()->actingAs(test()->owner)->postJson(TRANSFERS, array_merge([
        'source' => test()->a->uuid, 'destination' => test()->b->uuid, 'directory' => '/plugins', 'items' => ['/config.yml'],
    ], $overrides));
}

test('copying keeps the original and delivers the exact bytes, binary included', function (): void {
    $bytes = "\x00\xff\xfePK\x03\x04".str_repeat("\x80\x00", 300);
    $this->wings->seed($this->a->uuid, '/config.yml', $bytes);
    $this->wings->seed($this->b->uuid, '/plugins', null);

    send()->assertOk()->assertJsonPath('items.0.status', 'copied')->assertJsonPath('bytes', mb_strlen($bytes, '8bit'));

    expect($this->wings->trees[$this->b->uuid]['/plugins/config.yml']['content'])->toBe($bytes);
    expect($this->wings->trees[$this->a->uuid]['/config.yml']['content'])->toBe($bytes);
    expect(array_filter($this->wings->paths($this->b->uuid), fn (string $path): bool => str_contains($path, '.gobia-transfer-')))->toBe([]);
});

test('moving a folder carries every nested file and removes the source only afterwards', function (): void {
    $this->wings->seed($this->a->uuid, '/world', null);
    $this->wings->seed($this->a->uuid, '/world/region', null);
    $this->wings->seed($this->a->uuid, '/world/level.dat', 'LEVEL');
    $this->wings->seed($this->a->uuid, '/world/region/r.0.0.mca', "\x01\x02\x03");
    $this->wings->seed($this->b->uuid, '/plugins', null);

    send(['items' => ['/world'], 'mode' => 'move'])->assertOk()->assertJsonPath('items.0.status', 'moved')->assertJsonPath('items.0.failed', 0);

    expect($this->wings->paths($this->b->uuid))->toContain('/plugins/world', '/plugins/world/level.dat', '/plugins/world/region', '/plugins/world/region/r.0.0.mca');
    expect($this->wings->trees[$this->b->uuid]['/plugins/world/region/r.0.0.mca']['content'])->toBe("\x01\x02\x03");
    expect($this->wings->paths($this->a->uuid))->toBe([]);
});

test('name collisions follow the chosen policy and never overwrite silently', function (): void {
    $this->wings->seed($this->a->uuid, '/config.yml', 'NEW');
    $this->wings->seed($this->b->uuid, '/plugins', null);
    $this->wings->seed($this->b->uuid, '/plugins/config.yml', 'OLD');

    send()->assertOk()->assertJsonPath('items.0.status', 'skipped');
    expect($this->wings->trees[$this->b->uuid]['/plugins/config.yml']['content'])->toBe('OLD');

    send(['conflict' => 'keep'])->assertOk()->assertJsonPath('items.0.status', 'copied');
    expect($this->wings->trees[$this->b->uuid]['/plugins/config (copy).yml']['content'])->toBe('NEW');
    expect($this->wings->trees[$this->b->uuid]['/plugins/config.yml']['content'])->toBe('OLD');

    send(['conflict' => 'replace'])->assertOk()->assertJsonPath('items.0.status', 'copied');
    expect($this->wings->trees[$this->b->uuid]['/plugins/config.yml']['content'])->toBe('NEW');
});

test('a file that arrives damaged is not kept and a move leaves the source alone', function (): void {
    $this->wings->seed($this->a->uuid, '/config.yml', 'ABCDEFGH');
    $this->wings->seed($this->b->uuid, '/plugins', null);
    $this->wings->corrupt = '.gobia-transfer-';

    send(['mode' => 'move'])->assertOk()->assertJsonPath('items.0.status', 'failed');

    expect($this->wings->paths($this->b->uuid))->toBe(['/plugins']);
    expect($this->wings->trees[$this->a->uuid]['/config.yml']['content'])->toBe('ABCDEFGH');
});

test('a person who may only read the source cannot write the destination or move', function (): void {
    $reader = User::factory()->create();
    Subuser::query()->forceCreate(['server_id' => $this->a->id, 'user_id' => $reader->id, 'permissions' => ['file.read', 'file.read-content']]);
    Subuser::query()->forceCreate(['server_id' => $this->b->id, 'user_id' => $reader->id, 'permissions' => ['file.read']]);
    $this->wings->seed($this->a->uuid, '/config.yml', 'X');
    $this->wings->seed($this->b->uuid, '/plugins', null);

    $this->actingAs($reader)->postJson(TRANSFERS, ['source' => $this->a->uuid, 'destination' => $this->b->uuid, 'directory' => '/plugins', 'items' => ['/config.yml']])->assertForbidden();
    expect($this->wings->paths($this->b->uuid))->toBe(['/plugins']);

    Subuser::query()->where('server_id', $this->b->id)->update(['permissions' => ['file.read', 'file.create']]);
    $this->actingAs($reader)->postJson(TRANSFERS, ['source' => $this->a->uuid, 'destination' => $this->b->uuid, 'directory' => '/plugins', 'items' => ['/config.yml'], 'mode' => 'move'])->assertForbidden();
    $this->actingAs($reader)->postJson(TRANSFERS, ['source' => $this->a->uuid, 'destination' => $this->b->uuid, 'directory' => '/plugins', 'items' => ['/config.yml'], 'conflict' => 'replace'])->assertForbidden();
    $this->actingAs($reader)->postJson(TRANSFERS, ['source' => $this->a->uuid, 'destination' => $this->b->uuid, 'directory' => '/plugins', 'items' => ['/config.yml']])->assertOk();
});

test('a stranger learns nothing and traversal is refused', function (): void {
    $stranger = User::factory()->create();
    $this->wings->seed($this->a->uuid, '/config.yml', 'X');

    $this->actingAs($stranger)->postJson(TRANSFERS, ['source' => $this->a->uuid, 'destination' => $this->b->uuid, 'directory' => '/', 'items' => ['/config.yml']])->assertForbidden();
    send(['items' => ['/../etc/passwd']])->assertUnprocessable();
    send(['directory' => '/plugins/../../x'])->assertUnprocessable();
    send(['source' => 'not-a-uuid'])->assertUnprocessable();
    // A server that does not exist answers like one the caller may not use.
    send(['source' => '00000000-0000-4000-8000-000000000000'])->assertForbidden();
});

test('a file above the size limit is refused with a reason and nothing is written', function (): void {
    config(['gobia_files.transfer.max_file_bytes' => 4]);
    $this->wings->seed($this->a->uuid, '/big.bin', '123456789');
    $this->wings->seed($this->b->uuid, '/plugins', null);

    send(['items' => ['/big.bin']])->assertOk()->assertJsonPath('items.0.status', 'failed');
    expect($this->wings->paths($this->b->uuid))->toBe(['/plugins']);
});

test('real binary data survives a copy byte for byte', function (): void {
    $bytes = random_bytes(3 * 1024 * 1024 + 17);
    $this->wings->seed($this->a->uuid, '/config.yml', $bytes);
    $this->wings->seed($this->b->uuid, '/plugins', null);

    send()->assertOk()->assertJsonPath('items.0.status', 'copied')->assertJsonPath('bytes', 3 * 1024 * 1024 + 17)->assertJsonStructure(['timings' => ['total']]);

    expect(hash('sha256', $this->wings->trees[$this->b->uuid]['/plugins/config.yml']['content']))->toBe(hash('sha256', $bytes));
});

test('a move whose original cannot be removed is reported incomplete, never moved, and can be finished', function (): void {
    $this->wings->seed($this->a->uuid, '/config.yml', 'KEEP');
    $this->wings->seed($this->b->uuid, '/plugins', null);
    $this->wings->failDelete = 'config.yml';

    send(['mode' => 'move'])->assertOk()->assertJsonPath('items.0.status', 'move_incomplete');
    expect($this->wings->trees[$this->a->uuid]['/config.yml']['content'])->toBe('KEEP');
    expect($this->wings->trees[$this->b->uuid]['/plugins/config.yml']['content'])->toBe('KEEP');

    $this->wings->failDelete = null;
    send(['mode' => 'move', 'conflict' => 'skip', 'resume' => true])->assertOk()->assertJsonPath('items.0.status', 'moved');
    expect($this->wings->paths($this->a->uuid))->toBe([]);
    expect($this->wings->trees[$this->b->uuid]['/plugins/config.yml']['content'])->toBe('KEEP');
});

test('a move with a skipped collision keeps the original', function (): void {
    $this->wings->seed($this->a->uuid, '/config.yml', 'NEW');
    $this->wings->seed($this->b->uuid, '/plugins', null);
    $this->wings->seed($this->b->uuid, '/plugins/config.yml', 'OLD');

    send(['mode' => 'move'])->assertOk()->assertJsonPath('items.0.status', 'skipped');
    expect($this->wings->trees[$this->a->uuid]['/config.yml']['content'])->toBe('NEW');
});

test('a copy into the same server with keep adds a second copy', function (): void {
    $this->wings->seed($this->a->uuid, '/config.yml', 'SAME');

    send(['destination' => $this->a->uuid, 'directory' => '/', 'conflict' => 'keep'])->assertOk()->assertJsonPath('items.0.status', 'copied');
    expect($this->wings->paths($this->a->uuid))->toBe(['/config (copy).yml', '/config.yml']);
});

test('one person can only run a few transfers at once', function (): void {
    $this->wings->seed($this->a->uuid, '/config.yml', 'X');
    config(['gobia_files.transfer.concurrent_per_user' => 2]);
    $held = [];
    foreach ([0, 1] as $slot) {
        $held[] = $lock = Cache::lock('gobia-files:transfer:'.$this->owner->id.':'.$slot, 60);
        expect($lock->get())->toBeTrue();
    }

    send()->assertStatus(429);

    $held[0]->release();
    send()->assertOk()->assertJsonPath('items.0.status', 'copied');
    // The slot is given back when the transfer ends, so the next one runs too.
    send(['conflict' => 'keep'])->assertOk();
});
