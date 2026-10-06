<?php

declare(strict_types=1);

namespace GobiaCore\Services;

use GobiaCore\Models\UserProfile;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Pterodactyl\Models\User;
use Throwable;

/**
 * Copies the personal data a Gobia 1.x panel kept in core tables (avatars, theme, icon colours, server order,
 * categories) into this extension's own tables.
 *
 * It only reads the 1.x tables and never changes or drops them, so it can be run again and a failed upgrade can be
 * rolled back by restoring the database. Rows are matched by id; anything already present here wins.
 */
class LegacyImporter
{
    public function __construct(private readonly AvatarService $avatars) {}

    /**
     * @param  string|null  $connection  Connection holding the 1.x tables; null means the panel's own database
     *                                   (the usual in place upgrade, where the old tables are still there).
     * @return array<string, int> What was (or, for a dry run, would be) copied or skipped, by label.
     */
    public function run(?string $connection = null, bool $dryRun = false): array
    {
        $legacy = DB::connection($connection);
        $report = ['skipped (user or server gone)' => 0];

        // Everything but the avatar files happens in one transaction, so a dry run and a failure both leave no trace.
        DB::beginTransaction();
        try {
            $this->profiles($legacy, $report);
            $this->preferences($legacy, $report);
            $this->categories($legacy, $report);
            $dryRun ? DB::rollBack() : DB::commit();
        } catch (Throwable $exception) {
            DB::rollBack();
            throw $exception;
        }

        // Files are written after the commit; a missing avatar file only skips that avatar.
        $this->avatars($legacy, $report, $dryRun);

        return $report;
    }

    /** @param  array<string, int>  $report */
    private function profiles(ConnectionInterface $legacy, array &$report): void
    {
        $report['profiles'] = 0;
        $schema = Schema::connection($legacy->getName());
        $columns = array_values(array_filter(['theme', 'recent_icon_colors'], fn (string $column): bool => $schema->hasColumn('users', $column)));
        if ($columns === []) {
            return;
        }

        foreach ($legacy->table('users')->select(['id', ...$columns])->orderBy('id')->cursor() as $row) {
            $theme = in_array($row->theme ?? 'system', UserProfile::THEMES, true) ? $row->theme : 'system';
            $colors = $this->colors($row->recent_icon_colors ?? null);
            if ($theme === 'system' && $colors === []) {
                continue;
            }
            if (! User::query()->whereKey($row->id)->exists()) {
                $report['skipped (user or server gone)']++;

                continue;
            }
            $profile = UserProfile::query()->find($row->id);
            if ($profile === null) {
                $profile = new UserProfile;
                $profile->user_id = $row->id;
                $profile->theme = $theme;
                $profile->recent_icon_colors = $colors === [] ? null : $colors;
                $profile->save();
                $report['profiles']++;
            }
        }
    }

    /** @return list<string> */
    private function colors(mixed $stored): array
    {
        $decoded = is_string($stored) ? json_decode($stored, true) : [];

        return is_array($decoded)
            ? array_values(array_filter($decoded, fn (mixed $color): bool => is_string($color) && preg_match('/^#[0-9a-fA-F]{6}$/', $color) === 1))
            : [];
    }

    /** @param  array<string, int>  $report */
    private function preferences(ConnectionInterface $legacy, array &$report): void
    {
        $report['server order'] = 0;
        $report['icon colours'] = 0;
        $schema = Schema::connection($legacy->getName());
        $userIds = User::query()->pluck('id')->flip();
        $serverIds = DB::table('servers')->pluck('id')->flip();

        /** @var array<string, array{user_id: int, server_id: int, position: int|null, icon_color: string|null}> $merged */
        $merged = [];
        if ($schema->hasTable('user_server_preferences')) {
            foreach ($legacy->table('user_server_preferences')->cursor() as $row) {
                $merged[$row->user_id.':'.$row->server_id] = ['user_id' => $row->user_id, 'server_id' => $row->server_id, 'position' => $row->position, 'icon_color' => null];
            }
        }
        if ($schema->hasTable('user_server_icon_colors')) {
            foreach ($legacy->table('user_server_icon_colors')->cursor() as $row) {
                $key = $row->user_id.':'.$row->server_id;
                $merged[$key] = ['user_id' => $row->user_id, 'server_id' => $row->server_id, 'position' => $merged[$key]['position'] ?? null, 'icon_color' => $row->color];
            }
        }

        foreach ($merged as $row) {
            if (! isset($userIds[$row['user_id']], $serverIds[$row['server_id']])) {
                $report['skipped (user or server gone)']++;

                continue;
            }
            if ($row['icon_color'] !== null && preg_match('/^#[0-9a-fA-F]{6}$/', $row['icon_color']) !== 1) {
                $row['icon_color'] = null;
            }
            $inserted = DB::table('gobia_server_preferences')->insertOrIgnore($row);
            if ($inserted > 0) {
                $report['server order'] += $row['position'] === null ? 0 : 1;
                $report['icon colours'] += $row['icon_color'] === null ? 0 : 1;
            }
        }
    }

    /** @param  array<string, int>  $report */
    private function categories(ConnectionInterface $legacy, array &$report): void
    {
        $report['categories'] = 0;
        $report['category members'] = 0;
        $schema = Schema::connection($legacy->getName());
        if (! $schema->hasTable('user_server_categories')) {
            return;
        }
        $userIds = User::query()->pluck('id')->flip();
        $serverIds = DB::table('servers')->pluck('id')->flip();

        foreach ($legacy->table('user_server_categories')->orderBy('id')->cursor() as $row) {
            if (! isset($userIds[$row->user_id])) {
                $report['skipped (user or server gone)']++;

                continue;
            }
            $report['categories'] += DB::table('gobia_server_categories')->insertOrIgnore([
                'id' => $row->id,
                'user_id' => $row->user_id,
                'name' => $row->name,
                'position' => $row->position,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ]);
        }

        if (! $schema->hasTable('user_server_category_members')) {
            return;
        }
        $categoryIds = DB::table('gobia_server_categories')->pluck('id')->flip();
        foreach ($legacy->table('user_server_category_members')->cursor() as $row) {
            if (! isset($categoryIds[$row->category_id], $serverIds[$row->server_id])) {
                $report['skipped (user or server gone)']++;

                continue;
            }
            $report['category members'] += DB::table('gobia_server_category_members')->insertOrIgnore([
                'category_id' => $row->category_id,
                'server_id' => $row->server_id,
                'position' => $row->position,
            ]);
        }
    }

    /** @param  array<string, int>  $report */
    private function avatars(ConnectionInterface $legacy, array &$report, bool $dryRun): void
    {
        $report['avatars'] = 0;
        $report['avatar files missing'] = 0;
        if (! Schema::connection($legacy->getName())->hasColumn('users', 'avatar_hash')) {
            return;
        }
        $disk = Storage::disk('local');

        foreach ($legacy->table('users')->whereNotNull('avatar_hash')->select(['id', 'uuid'])->orderBy('id')->cursor() as $row) {
            $user = User::query()->find($row->id);
            if ($user === null || UserProfile::query()->whereKey($row->id)->whereNotNull('avatar_file')->exists()) {
                continue;
            }
            // 1.x derived the path from the user's uuid, never from anything the client sent.
            $path = 'avatars/'.$row->uuid.'.png';
            if (! $disk->exists($path)) {
                $report['avatar files missing']++;

                continue;
            }
            if ($dryRun) {
                $report['avatars']++;

                continue;
            }
            $this->avatars->store($user, new UploadedFile($disk->path($path), 'avatar.png', 'image/png', null, true));
            $report['avatars']++;
        }
    }
}
