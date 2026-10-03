<?php

namespace Pterodactyl\Services\Templates;

use Pterodactyl\Models\ServerTemplate;
use Pterodactyl\Models\ServerTemplateFile;
use Pterodactyl\Exceptions\DisplayException;

/**
 * Private storage for the files a template deploys into new servers.
 *
 * Content is stored in a directory only the Panel can read (storage/app/private/templates/<uuid>/blobs),
 * addressed by the SHA-256 of the content. The file paths that users type are only ever metadata in the
 * database and are never used to build a path on the Panel's disk, so a crafted path cannot reach
 * anything outside the blob directory. Paths are still validated strictly because they become paths
 * inside the new server when files are deployed.
 */
class TemplateFileStore
{
    public const MAX_FILES = 200;
    public const MAX_FILE_BYTES = 1048576;
    public const MAX_TOTAL_BYTES = 20971520;

    /**
     * Names that are never deployed: they belong to the daemon or are commonly abused to leak secrets.
     */
    private const RESERVED_SEGMENTS = ['.pterodactyl', '.wings', '.env', '.htaccess', '.htpasswd'];

    public function baseDirectory(ServerTemplate $template): string
    {
        return storage_path('app/private/templates/' . $template->uuid . '/blobs');
    }

    /**
     * Validates and normalizes a relative file path. Throws for anything that could escape the server root
     * or that is ambiguous: absolute paths, drive letters, "." / ".." segments, backslashes, control
     * characters, empty segments and percent-encoded separators or dots.
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
        // Percent-encoded characters (including double encoding) are rejected outright instead of being decoded, so no later
        // decoding step (a web server, Wings, a user's tooling) can turn them into a traversal.
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
     * @throws DisplayException
     */
    public function validateContent(string $content): void
    {
        if (strlen($content) > self::MAX_FILE_BYTES) {
            throw new DisplayException('Template files are limited to ' . (self::MAX_FILE_BYTES / 1048576) . ' MiB each.');
        }
        if (str_contains($content, "\0") || !mb_check_encoding($content, 'UTF-8')) {
            throw new DisplayException('Template files must be UTF-8 text.');
        }
    }

    /**
     * Stores the content and returns [sha256, size]. Identical content is only written once.
     *
     * @return array{0: string, 1: int}
     *
     * @throws DisplayException
     */
    public function write(ServerTemplate $template, string $content): array
    {
        $this->validateContent($content);

        $hash = hash('sha256', $content);
        $directory = $this->baseDirectory($template);
        if (!is_dir($directory) && !@mkdir($directory, 0750, true) && !is_dir($directory)) {
            throw new DisplayException('The template file storage is not writable.');
        }

        $target = $directory . DIRECTORY_SEPARATOR . $hash;
        if (!is_file($target)) {
            $temporary = $target . '.' . bin2hex(random_bytes(4)) . '.tmp';
            if (file_put_contents($temporary, $content, LOCK_EX) === false || !@rename($temporary, $target)) {
                @unlink($temporary);

                throw new DisplayException('The template file could not be written.');
            }
        }

        return [$hash, strlen($content)];
    }

    /**
     * Reads a stored blob by checksum. The checksum is validated as hex, and the resolved location must be a
     * regular file inside the template's own directory, which also defeats a symlink planted in the store.
     *
     * @throws DisplayException
     */
    public function read(ServerTemplate $template, string $sha256): string
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $sha256)) {
            throw new DisplayException('Invalid file reference.');
        }

        $directory = realpath($this->baseDirectory($template));
        $file = $directory ? $directory . DIRECTORY_SEPARATOR . $sha256 : false;
        if (!$directory || !is_file($file) || is_link($file)) {
            throw new DisplayException('A template file is missing from storage.');
        }

        $resolved = realpath($file);
        if ($resolved === false || !str_starts_with($resolved, $directory . DIRECTORY_SEPARATOR)) {
            throw new DisplayException('A template file is missing from storage.');
        }

        $content = file_get_contents($resolved);
        if ($content === false || hash('sha256', $content) !== $sha256) {
            throw new DisplayException('A template file failed its integrity check.');
        }

        return $content;
    }

    public function readFile(ServerTemplateFile $file): string
    {
        return $this->read($file->template, $file->sha256);
    }

    public function deleteAll(ServerTemplate $template): void
    {
        $root = dirname($this->baseDirectory($template));
        if (!is_dir($root)) {
            return;
        }

        foreach (scandir($root . DIRECTORY_SEPARATOR . 'blobs') ?: [] as $name) {
            @unlink($root . DIRECTORY_SEPARATOR . 'blobs' . DIRECTORY_SEPARATOR . $name);
        }
        @rmdir($root . DIRECTORY_SEPARATOR . 'blobs');
        @rmdir($root);
    }
}
