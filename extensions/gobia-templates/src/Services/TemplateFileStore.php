<?php

namespace GobiaTemplates\Services;

use GobiaTemplates\Models\ServerTemplate;
use Pterodactyl\Exceptions\DisplayException;

/**
 * Private file storage for server templates.
 *
 * Every template owns two directories under the configured storage root (never served by the web server):
 *
 *   work/    the working tree. This is what administrators edit in the browser and over SFTP. It holds ordinary files
 *            and folders, any size or type.
 *   blobs/   content-addressed copies (named by SHA-256) of every file that was ever published. A revision is a list
 *            of path + checksum pairs pointing at these blobs, so published revisions never change.
 *
 * Paths typed by users are validated by normalizePath() and resolved with resolve(), which refuses anything that
 * would leave the working tree: parent segments, absolute paths, encoded separators, and symlinks.
 */
class TemplateFileStore
{
    /**
     * Names that are never deployed: they belong to the daemon or are commonly abused to leak secrets.
     */
    private const RESERVED_SEGMENTS = ['.pterodactyl', '.wings', '.env', '.htaccess', '.htpasswd'];

    public function root(): string
    {
        return rtrim((string) config('gobia_templates.storage'), '/\\');
    }

    public function templateDirectory(ServerTemplate $template): string
    {
        return $this->root() . DIRECTORY_SEPARATOR . $template->uuid;
    }

    public function workDirectory(ServerTemplate $template): string
    {
        return $this->templateDirectory($template) . DIRECTORY_SEPARATOR . 'work';
    }

    public function blobDirectory(ServerTemplate $template): string
    {
        return $this->templateDirectory($template) . DIRECTORY_SEPARATOR . 'blobs';
    }

    /** @return array{max_file_bytes: int, max_total_bytes: int, max_files: int, max_edit_bytes: int} */
    public function limits(): array
    {
        return (array) config('gobia_templates.limits');
    }

    /**
     * Validates and normalizes a relative file path. Throws for anything that could escape the server root
     * or that is ambiguous: absolute paths, drive letters, "." / ".." segments, backslashes, control
     * characters, empty segments and percent-encoded characters.
     *
     * @throws DisplayException
     */
    public function normalizePath(string $path): string
    {
        $path = trim($path);

        $fail = fn (string $reason) => throw new DisplayException('Invalid template file path: ' . $reason . '.');

        if ($path === '' || strlen($path) > 255) {
            $fail('the path must be 1 to 255 characters');
        }
        if (!mb_check_encoding($path, 'UTF-8') || preg_match('/[\x00-\x1F\x7F]/', $path)) {
            $fail('control characters are not allowed');
        }
        if (str_contains($path, '\\')) {
            $fail('backslashes are not allowed');
        }
        if (str_starts_with($path, '/') || preg_match('/^[A-Za-z]:/', $path)) {
            $fail('absolute paths are not allowed');
        }
        // Percent-encoded characters (including double encoding) are rejected outright instead of being decoded, so no
        // later decoding step (a web server, Wings, a user's tooling) can turn them into a traversal.
        if (preg_match('/%[0-9a-f]{2}/i', $path)) {
            $fail('percent-encoded characters are not allowed');
        }

        $segments = explode('/', $path);
        foreach ($segments as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                $fail('empty, "." and ".." segments are not allowed');
            }
            if (in_array(strtolower($segment), self::RESERVED_SEGMENTS, true)) {
                $fail('"' . $segment . '" is a reserved name');
            }
            if (preg_match('/^\.+$/', $segment) || preg_match('/[<>:"|?*]/', $segment)) {
                $fail('the name "' . $segment . '" is not allowed');
            }
        }

        return implode('/', $segments);
    }

    /**
     * Makes sure the working tree exists. The first time a template that only has published files is opened, the
     * working tree is filled from the latest published revision.
     */
    public function ensureWorkingTree(ServerTemplate $template): string
    {
        $work = $this->workDirectory($template);
        if (is_dir($work)) {
            return $work;
        }

        $this->makeDirectory($work);
        foreach ($template->files()->get() as $file) {
            $target = $this->resolve($template, $file->path);
            $this->makeDirectory(dirname($target));
            $blob = $this->blobPath($template, $file->sha256);
            if (!@copy($blob, $target)) {
                throw new DisplayException('The working files could not be prepared.');
            }
        }

        return $work;
    }

    /**
     * Absolute path of a file or folder inside the working tree. Nothing outside the tree can be returned: the path is
     * validated, every existing component must be a real file or folder (never a symlink), and the result must lie
     * inside the tree.
     *
     * @throws DisplayException
     */
    public function resolve(ServerTemplate $template, string $path): string
    {
        $relative = $this->normalizePath($path);
        $work = $this->workDirectory($template);

        $current = $work;
        foreach (explode('/', $relative) as $segment) {
            $current .= DIRECTORY_SEPARATOR . $segment;
            if (is_link($current)) {
                throw new DisplayException('Symbolic links are not allowed in template files.');
            }
        }

        $real = realpath(dirname($current));
        $workReal = realpath($work);
        if ($real !== false && $workReal !== false && $real !== $workReal && !str_starts_with($real, $workReal . DIRECTORY_SEPARATOR)) {
            throw new DisplayException('That path is outside the template.');
        }

        return $current;
    }

    /**
     * Every file in the working tree (symlinks are ignored), sorted by path.
     *
     * @return array<int, array{path: string, size: int, type: string, modified: int}>
     */
    public function scan(ServerTemplate $template): array
    {
        $work = $this->ensureWorkingTree($template);
        $prefix = strlen(str_replace('\\', '/', $work)) + 1;
        $entries = [];
        $count = 0;
        $max = $this->limits()['max_files'] * 2;

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($work, \FilesystemIterator::SKIP_DOTS | \FilesystemIterator::UNIX_PATHS),
            \RecursiveIteratorIterator::SELF_FIRST
        );
        foreach ($iterator as $item) {
            if ($item->isLink()) {
                continue;
            }
            if (++$count > $max) {
                break;
            }
            $entries[] = [
                'path' => substr(str_replace('\\', '/', $item->getPathname()), $prefix),
                'size' => $item->isFile() ? $item->getSize() : 0,
                'type' => $item->isDir() ? 'directory' : 'file',
                'modified' => $item->getMTime(),
            ];
        }
        usort($entries, fn ($a, $b) => strcmp($a['path'], $b['path']));

        return $entries;
    }

    /** @return array{files: int, bytes: int} */
    public function usage(ServerTemplate $template): array
    {
        $files = 0;
        $bytes = 0;
        foreach ($this->scan($template) as $entry) {
            if ($entry['type'] === 'file') {
                ++$files;
                $bytes += $entry['size'];
            }
        }

        return ['files' => $files, 'bytes' => $bytes];
    }

    /**
     * @throws DisplayException
     */
    public function assertCanStore(ServerTemplate $template, string $path, int $newSize): void
    {
        $limits = $this->limits();
        if ($newSize > $limits['max_file_bytes']) {
            throw new DisplayException('A template file can be at most ' . $this->human($limits['max_file_bytes']) . '.');
        }

        $existing = 0;
        $isNew = true;
        $absolute = $this->resolve($template, $path);
        if (is_file($absolute)) {
            $existing = (int) filesize($absolute);
            $isNew = false;
        }
        $usage = $this->usage($template);
        if ($isNew && $limits['max_files'] < $usage['files'] + 1) {
            throw new DisplayException('A template can hold at most ' . $limits['max_files'] . ' files.');
        }
        if ($limits['max_total_bytes'] < $usage['bytes'] - $existing + $newSize) {
            throw new DisplayException('A template can hold at most ' . $this->human($limits['max_total_bytes']) . ' of files.');
        }
    }

    /**
     * Writes text (UTF-8, no NUL) to a file of the working tree.
     *
     * @throws DisplayException
     */
    public function writeText(ServerTemplate $template, string $path, string $content): void
    {
        if (str_contains($content, "\0") || !mb_check_encoding($content, 'UTF-8')) {
            throw new DisplayException('Only UTF-8 text can be saved in the editor. Upload other files instead.');
        }
        if (strlen($content) > $this->limits()['max_edit_bytes']) {
            throw new DisplayException('Files above ' . $this->human($this->limits()['max_edit_bytes']) . ' cannot be edited in the browser. Upload them instead.');
        }

        $this->ensureWorkingTree($template);
        $this->assertCanStore($template, $path, strlen($content));
        $target = $this->resolve($template, $path);
        $this->assertNoFolderConflict($template, $path);
        $this->makeDirectory(dirname($target));
        if (file_put_contents($target, $content, LOCK_EX) === false) {
            throw new DisplayException('The file could not be written.');
        }
    }

    /**
     * Streams an upload into the working tree without holding it in memory, enforcing the size limit while reading.
     *
     * @param resource $stream
     *
     * @throws DisplayException
     */
    public function writeStream(ServerTemplate $template, string $path, $stream, ?int $declaredSize = null): int
    {
        $this->ensureWorkingTree($template);
        $limit = $this->limits()['max_file_bytes'];
        $this->assertCanStore($template, $path, $declaredSize ?? 0);
        $this->assertNoFolderConflict($template, $path);

        $target = $this->resolve($template, $path);
        $this->makeDirectory(dirname($target));
        $temporary = $target . '.upload-' . bin2hex(random_bytes(4));
        $handle = @fopen($temporary, 'wb');
        if (!$handle) {
            throw new DisplayException('The file could not be written.');
        }

        $written = 0;
        try {
            while (!feof($stream)) {
                $chunk = fread($stream, 1048576);
                if ($chunk === false) {
                    throw new DisplayException('The upload was interrupted.');
                }
                $written += strlen($chunk);
                if ($written > $limit) {
                    throw new DisplayException('A template file can be at most ' . $this->human($limit) . '.');
                }
                fwrite($handle, $chunk);
            }
            fclose($handle);
            $handle = null;
            $this->assertCanStore($template, $path, $written);
            if (!@rename($temporary, $target)) {
                if (!@copy($temporary, $target)) {
                    throw new DisplayException('The file could not be written.');
                }
            }
        } finally {
            if (is_resource($handle)) {
                fclose($handle);
            }
            @unlink($temporary);
        }

        return $written;
    }

    /**
     * @throws DisplayException
     */
    public function makeFolder(ServerTemplate $template, string $path): void
    {
        $this->ensureWorkingTree($template);
        $target = $this->resolve($template, $path);
        if (is_file($target)) {
            throw new DisplayException('A file with that name already exists.');
        }
        $this->makeDirectory($target);
    }

    /**
     * Removes a file or a whole folder from the working tree.
     *
     * @throws DisplayException
     */
    public function remove(ServerTemplate $template, string $path): void
    {
        $this->ensureWorkingTree($template);
        $target = $this->resolve($template, $path);
        if (!file_exists($target)) {
            throw new DisplayException('That file or folder does not exist.');
        }
        $this->deleteRecursively($target);
    }

    /**
     * Renames or moves a file or folder inside the working tree.
     *
     * @throws DisplayException
     */
    public function move(ServerTemplate $template, string $from, string $to): void
    {
        $this->ensureWorkingTree($template);
        $source = $this->resolve($template, $from);
        $destination = $this->resolve($template, $to);
        $from = $this->normalizePath($from);
        $to = $this->normalizePath($to);

        if (!file_exists($source)) {
            throw new DisplayException('That file or folder does not exist.');
        }
        if ($to === $from || str_starts_with($to . '/', $from . '/')) {
            throw new DisplayException('A folder cannot be moved into itself.');
        }
        if (file_exists($destination)) {
            throw new DisplayException('Something with that name already exists there.');
        }
        $this->assertNoFolderConflict($template, $to);
        $this->makeDirectory(dirname($destination));
        if (!@rename($source, $destination)) {
            throw new DisplayException('It could not be moved.');
        }
    }

    /**
     * Hashes every file of the working tree and makes sure each has a blob. Returns the manifest to publish.
     *
     * @return array<int, array{path: string, size: int, sha256: string}>
     *
     * @throws DisplayException
     */
    public function snapshotWorkingTree(ServerTemplate $template): array
    {
        $this->makeDirectory($this->blobDirectory($template));
        $manifest = [];

        foreach ($this->scan($template) as $entry) {
            if ($entry['type'] !== 'file') {
                continue;
            }
            $source = $this->resolve($template, $entry['path']);
            $hash = hash_file('sha256', $source);
            if ($hash === false) {
                throw new DisplayException('A template file could not be read.');
            }
            $blob = $this->blobDirectory($template) . DIRECTORY_SEPARATOR . $hash;
            if (!is_file($blob)) {
                $temporary = $blob . '.' . bin2hex(random_bytes(4)) . '.tmp';
                if (!@copy($source, $temporary) || !@rename($temporary, $blob)) {
                    @unlink($temporary);

                    throw new DisplayException('A template file could not be stored.');
                }
            }
            $manifest[] = ['path' => $entry['path'], 'size' => $entry['size'], 'sha256' => $hash];
        }

        return $manifest;
    }

    /**
     * Path of a published blob, verified to be a regular file inside the template's blob directory.
     *
     * @throws DisplayException
     */
    public function blobPath(ServerTemplate $template, string $sha256): string
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $sha256)) {
            throw new DisplayException('Invalid file reference.');
        }

        $directory = realpath($this->blobDirectory($template));
        $file = $directory ? $directory . DIRECTORY_SEPARATOR . $sha256 : false;
        if (!$directory || !is_file($file) || is_link($file)) {
            throw new DisplayException('A template file is missing from storage.');
        }

        $resolved = realpath($file);
        if ($resolved === false || !str_starts_with($resolved, $directory . DIRECTORY_SEPARATOR)) {
            throw new DisplayException('A template file is missing from storage.');
        }

        return $resolved;
    }

    /**
     * Reads a published blob completely (small files only) and checks its checksum.
     *
     * @throws DisplayException
     */
    public function read(ServerTemplate $template, string $sha256): string
    {
        $path = $this->blobPath($template, $sha256);
        $content = file_get_contents($path);
        if ($content === false || hash('sha256', $content) !== $sha256) {
            throw new DisplayException('A template file failed its integrity check.');
        }

        return $content;
    }

    public function deleteAll(ServerTemplate $template): void
    {
        $directory = $this->templateDirectory($template);
        if (is_dir($directory) && str_starts_with(realpath($directory) ?: '', realpath($this->root()) ?: "\0")) {
            $this->deleteRecursively($directory);
        }
    }

    /**
     * Copies a template's working tree and blobs to another template (used when duplicating).
     */
    public function copyTemplate(ServerTemplate $source, ServerTemplate $target): void
    {
        foreach (['work', 'blobs'] as $part) {
            $from = $this->templateDirectory($source) . DIRECTORY_SEPARATOR . $part;
            $to = $this->templateDirectory($target) . DIRECTORY_SEPARATOR . $part;
            $this->makeDirectory($to);
            if (is_dir($from)) {
                $this->copyRecursively($from, $to);
            }
        }
    }

    private function copyRecursively(string $from, string $to): void
    {
        foreach (scandir($from) ?: [] as $name) {
            if ($name === '.' || $name === '..' || is_link($from . DIRECTORY_SEPARATOR . $name)) {
                continue;
            }
            $source = $from . DIRECTORY_SEPARATOR . $name;
            $destination = $to . DIRECTORY_SEPARATOR . $name;
            if (is_dir($source)) {
                $this->makeDirectory($destination);
                $this->copyRecursively($source, $destination);
            } else {
                @copy($source, $destination);
            }
        }
    }

    public function human(int $bytes): string
    {
        foreach (['bytes', 'KiB', 'MiB', 'GiB', 'TiB'] as $i => $unit) {
            if ($bytes < 1024 ** ($i + 1) || $unit === 'TiB') {
                return ($i === 0 ? $bytes : round($bytes / 1024 ** $i, 1)) . ' ' . $unit;
            }
        }

        return $bytes . ' bytes';
    }

    private function makeDirectory(string $directory): void
    {
        if (!is_dir($directory) && !@mkdir($directory, 0750, true) && !is_dir($directory)) {
            throw new DisplayException('The template file storage is not writable.');
        }
    }

    /**
     * A path cannot be both a file and a folder: "a" and "a/b" exclude each other.
     *
     * @throws DisplayException
     */
    private function assertNoFolderConflict(ServerTemplate $template, string $path): void
    {
        $relative = $this->normalizePath($path);
        $segments = explode('/', $relative);
        array_pop($segments);
        $current = $this->workDirectory($template);
        foreach ($segments as $segment) {
            $current .= DIRECTORY_SEPARATOR . $segment;
            if (is_file($current)) {
                throw new DisplayException('"' . $segment . '" is a file, so it cannot contain other files.');
            }
        }
        if (is_dir($this->resolve($template, $relative))) {
            throw new DisplayException('A folder with that name already exists.');
        }
    }

    private function deleteRecursively(string $path): void
    {
        if (is_link($path) || is_file($path)) {
            @unlink($path);

            return;
        }
        foreach (scandir($path) ?: [] as $name) {
            if ($name !== '.' && $name !== '..') {
                $this->deleteRecursively($path . DIRECTORY_SEPARATOR . $name);
            }
        }
        @rmdir($path);
    }
}
