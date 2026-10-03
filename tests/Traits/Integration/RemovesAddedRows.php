<?php

namespace Pterodactyl\Tests\Traits\Integration;

use Illuminate\Support\Facades\DB;

/**
 * For tests that cannot run inside a transaction.
 *
 * The Panel's exception handler rolls back any open transaction when it renders an error response, which would
 * wipe the fixtures of a test that expects several error responses. Such tests remember how far every table had
 * grown before they started and delete whatever they added afterwards, so they leave the shared test database
 * exactly as they found it.
 */
trait RemovesAddedRows
{
    /** Tables written by these tests, in an order that respects their relations. */
    private static array $cleanedTables = [
        'server_template_instances' => 'id',
        'server_templates' => 'id',
        'server_variables' => 'server_id',
        'servers' => 'id',
        'allocations' => 'id',
        'nodes' => 'id',
        'locations' => 'id',
        'api_keys' => 'id',
        'users' => 'id',
    ];

    /** @var array<string, int> */
    private array $highWater = [];

    protected function rememberHighWater(): void
    {
        foreach (self::$cleanedTables as $table => $column) {
            $this->highWater[$table] = (int) DB::table($table)->max($column);
        }
    }

    protected function removeAddedRows(): void
    {
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        foreach (self::$cleanedTables as $table => $column) {
            DB::table($table)->where($column, '>', $this->highWater[$table] ?? PHP_INT_MAX)->delete();
        }
        DB::statement('SET FOREIGN_KEY_CHECKS=1');
    }
}
