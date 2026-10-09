<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

use Illuminate\Support\Facades\DB;
use GobiaCore\Updater\Exceptions\UpdateException;

/**
 * Creates and restores the database dumps used for update rollback. These are separate from
 * the server backups users create; they only exist to undo a failed Panel update.
 */
class DatabaseBackupService
{
    public function __construct(private ProcessRunner $processes)
    {
    }

    /**
     * Dumps the Panel database to $directory and verifies the dump before returning its path.
     *
     * @throws UpdateException
     */
    public function create(string $directory, string $name): string
    {
        $connection = $this->connection();
        $binary = $this->processes->find(config('gobia_updater.mysqldump'), ['mariadb-dump', 'mysqldump']);

        if (!is_dir($directory) && !@mkdir($directory, 0750, true)) {
            throw new UpdateException('The backup directory could not be created.');
        }
        $file = rtrim(str_replace('\\', '/', $directory), '/') . '/' . $name . '.sql';

        $result = $this->processes->run(
            array_merge([$binary], $this->clientArguments($connection), [
                '--single-transaction',
                '--routines',
                '--triggers',
                '--default-character-set=utf8mb4',
                '--result-file=' . $file,
                $connection['database'],
            ]),
            null,
            ['MYSQL_PWD' => (string) ($connection['password'] ?? '')],
            900
        );

        if (!$result->successful()) {
            @unlink($file);
            throw new UpdateException('The database backup failed: ' . Redactor::scrub(trim($result->error)));
        }

        // The dump holds password hashes and encrypted keys: nobody but the Panel user reads it, whatever the umask.
        @chmod($file, 0600);
        $this->verify($file);

        return $file;
    }

    /**
     * Replaces the whole database with the contents of a dump. Tables that did not exist when the dump was
     * taken (for example from a half-applied migration) are dropped first so the schema matches exactly.
     *
     * @throws UpdateException
     */
    public function restore(string $file): void
    {
        $this->verify($file);

        $connection = $this->connection();
        $binary = $this->processes->find(config('gobia_updater.mysql'), ['mariadb', 'mysql']);

        $pdo = DB::connection()->getPdo();
        $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
        foreach ($pdo->query('SHOW FULL TABLES')->fetchAll(\PDO::FETCH_NUM) as [$table, $type]) {
            $pdo->exec(($type === 'VIEW' ? 'DROP VIEW ' : 'DROP TABLE ') . '`' . str_replace('`', '``', $table) . '`');
        }
        $pdo->exec('SET FOREIGN_KEY_CHECKS=1');

        $input = fopen($file, 'rb');
        $result = $this->processes->run(
            array_merge([$binary], $this->clientArguments($connection), ['--default-character-set=utf8mb4', $connection['database']]),
            null,
            ['MYSQL_PWD' => (string) ($connection['password'] ?? '')],
            1800,
            $input
        );
        fclose($input);

        if (!$result->successful()) {
            throw new UpdateException('Restoring the database backup failed: ' . Redactor::scrub(trim($result->error)));
        }

        DB::purge();
    }

    /**
     * A usable dump is non-empty and ends with the footer mysqldump writes after a complete run.
     *
     * @throws UpdateException
     */
    public function verify(string $file): void
    {
        if (!is_file($file) || filesize($file) < 200) {
            throw new UpdateException('The database backup is missing or empty.');
        }

        $size = filesize($file);
        $tail = (string) file_get_contents($file, false, null, max(0, $size - 512));
        if (!str_contains($tail, 'Dump completed')) {
            throw new UpdateException('The database backup is incomplete.');
        }
    }

    private function connection(): array
    {
        $config = config('database.connections.' . config('database.default'));
        if (!is_array($config) || !in_array($config['driver'] ?? null, ['mysql', 'mariadb'], true)) {
            throw new UpdateException('Only MySQL and MariaDB databases are supported by the updater.');
        }

        return $config;
    }

    private function clientArguments(array $connection): array
    {
        if (!empty($connection['unix_socket'])) {
            return ['--socket=' . $connection['unix_socket'], '--user=' . $connection['username']];
        }

        return [
            '--host=' . ($connection['host'] ?? '127.0.0.1'),
            '--port=' . ($connection['port'] ?? 3306),
            '--user=' . $connection['username'],
        ];
    }
}
