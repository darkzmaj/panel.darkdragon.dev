<?php

namespace Pterodactyl\Tests\Integration\Services\Templates;

use Pterodactyl\Models\ServerTemplate;
use Pterodactyl\Models\TemplateInstance;
use Pterodactyl\Exceptions\DisplayException;
use Illuminate\Validation\ValidationException;
use Pterodactyl\Services\Templates\TemplateService;
use Pterodactyl\Services\Templates\TemplateFileStore;
use Pterodactyl\Tests\Integration\IntegrationTestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Pterodactyl\Tests\Traits\Integration\BuildsTemplates;

class TemplateServiceTest extends IntegrationTestCase
{
    use BuildsTemplates;
    use DatabaseTransactions;

    private TemplateService $service;

    public function setUp(): void
    {
        parent::setUp();
        $this->useTemplateStorage();
        $this->service = app(TemplateService::class);
    }

    public function tearDown(): void
    {
        $this->removeTemplateStorage();
        parent::tearDown();
    }

    public function testATemplateIsCreatedWithAUniqueSlugAndFirstRevision(): void
    {
        $first = $this->makeTemplate();
        $second = $this->makeTemplate();

        $this->assertSame('lobby', $first->slug);
        $this->assertSame('lobby-2', $second->slug);
        $this->assertSame(1, $first->revision);
        $this->assertSame(1, $first->revisions()->count());
    }

    public function testInvalidTemplatesAreRejected(): void
    {
        $other = \Pterodactyl\Models\Egg::query()->where('nest_id', '!=', $this->bungeecord()->nest_id)->first();

        $cases = [
            'egg from another nest' => [['egg_id' => $other->id], 'egg_id'],
            'image not offered by the egg' => [['docker_image' => 'evil/image:latest'], 'docker_image'],
            'unknown variable' => [['variables' => ['NOPE' => ['value' => 'x']]], 'variables.NOPE'],
            'fixed placement without a node' => [['placement_mode' => 'fixed_node', 'node_id' => null], 'node_id'],
            'allowed placement without nodes' => [['placement_mode' => 'allowed_nodes'], 'allowed_nodes'],
            'bad port specification' => [['preferred_ports' => '25565,abc'], 'preferred_ports'],
            'port out of range' => [['preferred_ports' => '70000'], 'preferred_ports'],
            'negative memory' => [['memory' => -5], 'memory'],
            'io out of range' => [['io' => 5], 'io'],
            'missing name' => [['name' => ''], 'name'],
        ];

        foreach ($cases as $label => [$override, $field]) {
            try {
                $this->service->create($this->templateInput($override));
                $this->fail("Expected a validation error for: $label");
            } catch (ValidationException $exception) {
                $this->assertArrayHasKey($field, $exception->errors(), $label);
            }
        }

        $this->assertSame(0, ServerTemplate::query()->count());
    }

    public function testEditingCreatesANewRevisionAndOldRevisionsStayIntact(): void
    {
        $template = $this->makeTemplate();
        $updated = $this->service->update($template, $this->templateInput(['memory' => 1024, 'name' => 'Lobby v2']));

        $this->assertSame(2, $updated->revision);
        $this->assertSame(256, $this->service->revision($updated, 1)->snapshot['settings']['memory']);
        $this->assertSame(1024, $this->service->revision($updated, 2)->snapshot['settings']['memory']);
    }

    public function testSavingWithoutChangesDoesNotCreateARevision(): void
    {
        $template = $this->makeTemplate();
        $same = $this->service->update($template, $this->templateInput());

        $this->assertSame(1, $same->revision);
        $this->assertSame(1, $same->revisions()->count());
    }

    public function testVariablesAreStoredAndSnapshotted(): void
    {
        $template = $this->makeTemplate();
        $snapshot = $this->service->snapshot($template);

        $byEnv = collect($snapshot['variables'])->keyBy('env');
        $this->assertSame('latest', $byEnv['BUNGEE_VERSION']['value']);
        $this->assertFalse($byEnv['BUNGEE_VERSION']['overridable']);
        $this->assertTrue($byEnv['SERVER_JARFILE']['overridable']);
    }

    public function testEditsGoToTheWorkingTreeAndPublishingCreatesRevisions(): void
    {
        $template = $this->makeTemplate();
        $store = app(TemplateFileStore::class);

        $this->service->putFile($template, 'plugins/config.yml', "a: 1\n");
        $template->refresh();

        // Saving a file does not publish anything: the published list is empty and there is no new revision.
        $this->assertSame(1, $template->revision);
        $this->assertSame(0, $template->files()->count());
        $status = $this->service->workingStatus($template);
        $this->assertTrue($status['dirty']);
        $this->assertSame(['plugins/config.yml'], $status['added']);

        $this->service->publish($template);
        $template->refresh();
        $this->assertSame(2, $template->revision);
        $file = $template->files()->first();
        $this->assertSame(hash('sha256', "a: 1\n"), $file->sha256);
        $this->assertSame("a: 1\n", $store->read($template, $file->sha256));
        $this->assertFalse($this->service->workingStatus($template)['dirty']);

        // Publishing again without changes does not create another revision.
        $this->service->publish($template);
        $this->assertSame(2, $template->refresh()->revision);

        // Editing shows up as modified, and the old revision keeps pointing at the old content.
        $this->service->putFile($template, 'plugins/config.yml', "a: 2\n");
        $this->assertSame(['plugins/config.yml'], $this->service->workingStatus($template)['modified']);
        $this->service->publish($template);
        $template->refresh();
        $this->assertSame(3, $template->revision);
        $this->assertSame(hash('sha256', "a: 1\n"), $this->service->revision($template, 2)->snapshot['files'][0]['sha256']);
        $this->assertSame("a: 1\n", $store->read($template, hash('sha256', "a: 1\n")));

        $this->service->deleteFile($template, 'plugins/config.yml');
        $this->assertSame(['plugins/config.yml'], $this->service->workingStatus($template)['deleted']);
        $this->service->publish($template);
        $this->assertSame(0, $template->files()->count());
        $this->assertSame(4, $template->refresh()->revision);
    }

    public function testBinaryFilesAndFoldersAreSupported(): void
    {
        $template = $this->makeTemplate();
        $store = app(TemplateFileStore::class);

        $binary = random_bytes(300000) . "\0\1\2";
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, $binary);
        rewind($stream);
        $this->assertSame(strlen($binary), $this->service->uploadFile($template, 'plugins/Essentials.jar', $stream, strlen($binary)));
        $this->service->makeFolder($template, 'world/region');
        $this->service->putFile($template, 'server.properties', "motd=hi\n");

        $this->service->publish($template);
        $paths = $template->refresh()->files()->pluck('path')->all();
        $this->assertSame(['plugins/Essentials.jar', 'server.properties'], $paths);
        $jar = $template->files()->where('path', 'plugins/Essentials.jar')->first();
        $this->assertSame($binary, $store->read($template, $jar->sha256));
        // The empty folder exists in the working tree but a folder alone is not published.
        $this->assertTrue(is_dir($store->workDirectory($template) . '/world/region'));
    }

    public function testFilesCanBeMovedAndRenamed(): void
    {
        $template = $this->makeTemplate();
        $this->service->putFile($template, 'config.yml', 'a');
        $this->service->makeFolder($template, 'plugins/MyPlugin');

        $this->service->moveFile($template, 'config.yml', 'plugins/MyPlugin/config.yml');
        $this->assertSame(['plugins', 'plugins/MyPlugin', 'plugins/MyPlugin/config.yml'], collect(app(TemplateFileStore::class)->scan($template))->pluck('path')->all());

        // A folder cannot be moved into itself, and nothing is overwritten.
        $this->expectException(DisplayException::class);
        $this->service->moveFile($template, 'plugins', 'plugins/MyPlugin/inside');
    }

    public function testMovingOntoAnExistingFileIsRefused(): void
    {
        $template = $this->makeTemplate();
        $this->service->putFile($template, 'a.txt', 'a');
        $this->service->putFile($template, 'b.txt', 'b');

        $this->expectException(DisplayException::class);
        $this->service->moveFile($template, 'a.txt', 'b.txt');
    }

    /**
     * @dataProvider unsafePaths
     */
    public function testUnsafeFilePathsAreRefused(string $path): void
    {
        $template = $this->makeTemplate();

        $this->expectException(DisplayException::class);
        try {
            $this->service->putFile($template, $path, 'x');
        } finally {
            $this->assertSame(0, $template->files()->count());
        }
    }

    public static function unsafePaths(): array
    {
        return [
            'parent segment' => ['../etc/passwd'],
            'nested parent' => ['plugins/../../x'],
            'absolute' => ['/etc/passwd'],
            'windows drive' => ['C:/Windows/win.ini'],
            'backslash' => ['plugins\\..\\x'],
            'encoded dots' => ['%2e%2e/secret'],
            'encoded slash' => ['plugins%2f..%2fx'],
            'encoded backslash' => ['a%5cb'],
            'double encoded marker' => ['%252e%252e/x'],
            'null byte' => ["a\0b"],
            'current dir segment' => ['./x'],
            'empty segment' => ['a//b'],
            'trailing slash' => ['dir/'],
            'only dots' => ['...'],
            'reserved daemon dir' => ['.pterodactyl/config.json'],
            'reserved env file' => ['sub/.env'],
            'wildcard' => ['a*b'],
            'too long' => [str_repeat('a', 256)],
            'empty' => [''],
        ];
    }

    public function testFileAndFolderCannotShareAPath(): void
    {
        $template = $this->makeTemplate();
        $this->service->putFile($template, 'plugins/a.yml', 'x');

        $this->expectException(DisplayException::class);
        $this->service->putFile($template, 'plugins', 'x');
    }

    public function testAFileCannotBecomeAFolder(): void
    {
        $template = $this->makeTemplate();
        $this->service->putFile($template, 'plugins', 'x');

        $this->expectException(DisplayException::class);
        $this->service->putFile($template, 'plugins/a.yml', 'x');
    }

    public function testEditorContentRules(): void
    {
        $template = $this->makeTemplate();

        foreach (["bin\0ary", "\xff\xfe invalid utf8", str_repeat('x', app(TemplateFileStore::class)->limits()['max_edit_bytes'] + 1)] as $content) {
            try {
                $this->service->putFile($template, 'f.txt', $content);
                $this->fail('Expected content to be refused.');
            } catch (DisplayException) {
                $this->assertFalse(is_file(app(TemplateFileStore::class)->workDirectory($template) . '/f.txt'));
            }
        }
    }

    public function testUploadsAreLimitedWhileReading(): void
    {
        config(['gobia_templates.limits.max_file_bytes' => 1000]);
        $template = $this->makeTemplate();
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, str_repeat('x', 5000));
        rewind($stream);

        try {
            $this->service->uploadFile($template, 'big.bin', $stream);
            $this->fail('Expected the upload to be refused.');
        } catch (DisplayException) {
            $store = app(TemplateFileStore::class);
            $this->assertFalse(is_file($store->workDirectory($template) . '/big.bin'));
            $this->assertSame([], glob($store->workDirectory($template) . '/*.upload-*') ?: []);
        }
    }

    public function testTheTotalSizeAndFileCountAreLimited(): void
    {
        config(['gobia_templates.limits.max_total_bytes' => 100, 'gobia_templates.limits.max_files' => 2]);
        $template = $this->makeTemplate();
        $this->service->putFile($template, 'a.txt', str_repeat('a', 60));

        try {
            $this->service->putFile($template, 'b.txt', str_repeat('b', 60));
            $this->fail('Expected the total size limit to apply.');
        } catch (DisplayException $e) {
            $this->assertStringContainsString('of files', $e->getMessage());
        }

        $this->service->putFile($template, 'b.txt', 'b');
        $this->expectException(DisplayException::class);
        $this->service->putFile($template, 'c.txt', 'c');
    }

    public function testAPlantedSymlinkInTheWorkingTreeIsNeitherListedNorFollowed(): void
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            $this->markTestSkipped('Creating symlinks needs elevated rights on Windows.');
        }

        $template = $this->makeTemplate();
        $store = app(TemplateFileStore::class);
        $this->service->putFile($template, 'real.txt', 'real');

        $secret = tempnam(sys_get_temp_dir(), 'secret');
        file_put_contents($secret, 'outside');
        symlink($secret, $store->workDirectory($template) . '/link.txt');
        symlink(sys_get_temp_dir(), $store->workDirectory($template) . '/dirlink');

        try {
            $this->assertSame(['real.txt'], collect($store->scan($template))->pluck('path')->all());
            foreach (['link.txt', 'dirlink/anything'] as $path) {
                try {
                    $store->resolve($template, $path);
                    $this->fail('A symlink must not be resolvable: ' . $path);
                } catch (DisplayException) {
                    $this->addToAssertionCount(1);
                }
            }
            $this->service->publish($template);
            $this->assertSame(['real.txt'], $template->refresh()->files()->pluck('path')->all());
        } finally {
            @unlink($secret);
        }
    }

    public function testAPlantedSymlinkInTheBlobStoreIsNotFollowed(): void
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            $this->markTestSkipped('Creating symlinks needs elevated rights on Windows.');
        }

        $template = $this->makeTemplate();
        $store = app(TemplateFileStore::class);
        $this->service->putFile($template, 'real.txt', 'real');
        $this->service->publish($template);

        $secret = tempnam(sys_get_temp_dir(), 'secret');
        file_put_contents($secret, 'outside');
        $link = $store->blobDirectory($template) . '/' . hash('sha256', 'outside');
        symlink($secret, $link);

        try {
            $store->read($template, hash('sha256', 'outside'));
            $this->fail('A symlink must not be readable.');
        } catch (DisplayException) {
            $this->assertSame('real', $store->read($template, hash('sha256', 'real')));
        } finally {
            @unlink($link);
            @unlink($secret);
        }
    }

    public function testDuplicateCopiesEverythingButStartsDisabled(): void
    {
        $node = $this->makeNode();
        $template = $this->makeTemplate(['placement_mode' => 'allowed_nodes', 'allowed_nodes' => [$node->id]]);
        $this->service->putFile($template, 'motd.txt', 'hello');
        $this->service->publish($template);

        $copy = $this->service->duplicate($template->refresh());

        $this->assertFalse($copy->enabled);
        $this->assertNotSame($template->uuid, $copy->uuid);
        $this->assertSame('lobby-copy', $copy->slug);
        $this->assertSame(1, $copy->revision);
        $this->assertSame([$node->id], $copy->allowedNodes()->pluck('nodes.id')->all());
        $this->assertSame('hello', app(TemplateFileStore::class)->read($copy, $copy->files()->first()->sha256));
        $this->assertSame('hello', file_get_contents(app(TemplateFileStore::class)->workDirectory($copy) . '/motd.txt'));
        $this->assertCount(2, $this->service->snapshot($copy)['variables']);
    }

    public function testDisablingAndDeletingUnusedTemplates(): void
    {
        $template = $this->makeTemplate();
        $this->service->setEnabled($template, false);
        $this->assertFalse($template->refresh()->enabled);

        $this->service->delete($template);
        $this->assertDatabaseMissing('server_templates', ['id' => $template->id]);
    }

    public function testATemplateWithInstanceHistoryCannotBeDeleted(): void
    {
        $template = $this->makeTemplate();
        TemplateInstance::query()->create([
            'uuid' => (string) \Ramsey\Uuid\Uuid::uuid4(),
            'template_id' => $template->id,
            'template_revision' => 1,
            'owner_id' => \Pterodactyl\Models\User::factory()->create()->id,
            'name' => 'x',
            'state' => 'failed',
        ]);

        $this->expectException(DisplayException::class);
        try {
            $this->service->delete($template);
        } finally {
            $this->assertDatabaseHas('server_templates', ['id' => $template->id]);
        }
    }

    public function testMassAssignmentCannotTouchSystemColumns(): void
    {
        $template = $this->service->create($this->templateInput(['uuid' => 'attacker-uuid', 'revision' => 99, 'id' => 12345]));

        $this->assertNotSame('attacker-uuid', $template->uuid);
        $this->assertSame(1, $template->revision);
        $this->assertNotSame(12345, $template->id);
    }
}
