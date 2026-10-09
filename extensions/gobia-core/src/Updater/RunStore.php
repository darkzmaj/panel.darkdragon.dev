<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

use Illuminate\Support\Str;
use GobiaCore\Updater\Exceptions\UpdateException;

/**
 * File based store for update runs. State deliberately lives outside the database: the database
 * is migrated, and may be restored from a backup, in the middle of an update, and the run record
 * has to survive that as well as the maintenance mode window.
 */
class RunStore
{
    /**
     * A run whose worker has not reported progress for this long, and does not hold the lock, is dead.
     */
    public const int STALE_AFTER = 180;

    public const string ID_PATTERN = '/^[0-9]{8}T[0-9]{6}-[a-z0-9]{6}$/D';

    public function __construct(private string $path)
    {
        $this->path = rtrim(str_replace('\\', '/', $path), '/');
    }

    public function path(string $sub = ''): string
    {
        $dir = $sub === '' ? $this->path : $this->path . '/' . $sub;
        if (!is_dir($dir)) {
            @mkdir($dir, 0750, true);
        }

        return $dir;
    }

    /**
     * Starts a new run, or fails with the id of the run that is already active. The exclusive
     * creation of the pointer file is the atomic step that prevents two updates being started.
     *
     * @return array{0: bool, 1: array} whether this call created the run, and the active run
     */
    public function begin(array $run): array
    {
        $pointer = $this->path('') . '/active';

        $handle = @fopen($pointer, 'x');
        if ($handle === false) {
            $activeId = trim((string) @file_get_contents($pointer));
            $active = $this->load($activeId);
            if ($active !== null) {
                return [false, $active];
            }

            // A pointer that refers to nothing is debris from a crashed run.
            @unlink($pointer);

            return $this->begin($run);
        }

        fwrite($handle, $run['id']);
        fclose($handle);
        $this->save($run);

        return [true, $run];
    }

    public function newId(): string
    {
        return gmdate('Ymd\THis') . '-' . Str::lower(Str::random(6));
    }

    public function active(): ?array
    {
        $pointer = $this->path . '/active';
        if (!is_file($pointer)) {
            return null;
        }

        return $this->load(trim((string) @file_get_contents($pointer)));
    }

    public function save(array $run): void
    {
        $file = $this->path('runs') . '/' . $this->safeId($run['id']) . '.json';
        $temp = $file . '.' . getmypid() . '.tmp';

        file_put_contents($temp, json_encode($run, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        rename($temp, $file);
    }

    public function load(?string $id): ?array
    {
        if ($id === null || preg_match(self::ID_PATTERN, $id) !== 1) {
            return null;
        }

        $file = $this->path . '/runs/' . $id . '.json';
        if (!is_file($file)) {
            return null;
        }

        $data = json_decode((string) file_get_contents($file), true);

        return is_array($data) ? $data : null;
    }

    public function release(string $id): void
    {
        $active = $this->active();
        if ($active !== null && $active['id'] === $id) {
            @unlink($this->path . '/active');
        }
    }

    /**
     * @return array[] newest first
     */
    public function history(int $limit = 10): array
    {
        $files = glob($this->path('runs') . '/*.json') ?: [];
        rsort($files);

        return collect($files)->take($limit)
            ->map(fn ($file) => json_decode((string) file_get_contents($file), true))
            ->filter()
            ->values()
            ->all();
    }

    public function lastWithResult(string $result): ?array
    {
        foreach ($this->history(50) as $run) {
            if (($run['result'] ?? null) === $result) {
                return $run;
            }
        }

        return null;
    }

    /**
     * Whether the active run's worker is gone: no recent heartbeat and nobody holds the lock.
     */
    public function isStale(array $run): bool
    {
        if (!empty($run['finished_at'])) {
            return false;
        }

        if (time() - (int) ($run['heartbeat'] ?? 0) < self::STALE_AFTER) {
            return false;
        }

        $handle = $this->tryLock();
        if ($handle === null) {
            return false;
        }
        $this->unlock($handle);

        return true;
    }

    /**
     * Takes the exclusive worker lock. Only one process can hold it, so only one update can ever execute.
     *
     * @return resource|null
     */
    public function tryLock()
    {
        $handle = @fopen($this->path('') . '/update.lock', 'c');
        if ($handle === false) {
            throw new UpdateException('The updater lock file is not writable.');
        }

        if (!flock($handle, LOCK_EX | LOCK_NB)) {
            fclose($handle);

            return null;
        }

        return $handle;
    }

    public function unlock($handle): void
    {
        flock($handle, LOCK_UN);
        fclose($handle);
    }

    public function log(string $id, string $line): void
    {
        $line = Redactor::scrub($line);
        file_put_contents($this->path('logs') . '/' . $this->safeId($id) . '.log', '[' . gmdate('c') . '] ' . $line . PHP_EOL, FILE_APPEND | LOCK_EX);
    }

    public function readLog(string $id, int $maxBytes = 65536): string
    {
        $file = $this->path . '/logs/' . $this->safeId($id) . '.log';
        if (!is_file($file)) {
            return '';
        }

        $size = filesize($file);

        return (string) file_get_contents($file, false, null, max(0, $size - $maxBytes));
    }

    private function safeId(string $id): string
    {
        if (!preg_match(self::ID_PATTERN, $id)) {
            throw new UpdateException('Invalid update run id.');
        }

        return $id;
    }
}
