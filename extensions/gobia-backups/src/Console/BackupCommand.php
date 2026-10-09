<?php

declare(strict_types=1);

namespace GobiaBackups\Console;

use GobiaBackups\Models\Run;
use GobiaBackups\Services\BackupService;
use GobiaBackups\Services\Scheduler;
use Illuminate\Console\Command;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Models\Server;

class BackupCommand extends Command
{
    protected $signature = 'gobia-backups:run {server? : Server uuid to back up now} {--list : Show the latest offsite backups instead}';

    protected $description = 'Start an offsite backup of a server, or list the latest ones.';

    public function handle(BackupService $backups, Scheduler $scheduler): int
    {
        if ($this->option('list') || ! $this->argument('server')) {
            $this->table(['Backup', 'Server', 'State', 'Size', 'Verified', 'Created', 'Error'], Run::query()->orderByDesc('id')->limit(30)->get()->map(fn (Run $run): array => [
                $run->uuid, $run->server_name, $run->state, number_format($run->bytes / 1048576, 1).' MiB', $run->verified_by ?? '', $run->created_at->toDateTimeString(), (string) $run->error,
            ])->all());

            return self::SUCCESS;
        }

        try {
            $run = $backups->request(Server::query()->where('uuid', $this->argument('server'))->firstOrFail(), Run::TRIGGER_MANUAL);
        } catch (DisplayException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }
        $scheduler->tick();
        $this->info('Backup '.$run->uuid.' is '.$run->refresh()->state.'. Wings builds the archive, then a queue worker uploads it; follow it with --list.');

        return self::SUCCESS;
    }
}
