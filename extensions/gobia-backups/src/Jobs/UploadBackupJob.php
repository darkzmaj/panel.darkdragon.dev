<?php

declare(strict_types=1);

namespace GobiaBackups\Jobs;

use GobiaBackups\Models\Run;
use GobiaBackups\Services\BackupService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Attributes\DeleteWhenMissingModels;
use Illuminate\Queue\Attributes\WithoutRelations;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Copies one finished archive from its node to the Storage Box. The upload of a large server takes a long time,
 * so it runs on a queue worker, never in a web request.
 */
#[DeleteWhenMissingModels]
class UploadBackupJob implements ShouldQueue
{
    use Queueable;

    /** A single attempt: BackupService records failures and decides about retries itself. */
    public int $tries = 1;

    public int $timeout;

    public function __construct(
        #[WithoutRelations]
        public readonly Run $run,
    ) {
        $this->timeout = (int) config('gobia_backups.transfer_timeout', 21600);
        // The Panel's workers listen on high, standard and low; the default queue is not processed.
        $this->onQueue('low');
    }

    public function handle(BackupService $backups): void
    {
        $run = $this->run->refresh();
        if ($run->state !== Run::UPLOADING) {
            return;
        }

        // Two workers must never upload the same archive at once.
        $lock = Cache::lock('gobia-backups:upload:'.$run->uuid, $this->timeout);
        if (! $lock->get()) {
            return;
        }

        try {
            $backups->upload($run);
        } finally {
            $lock->release();
        }
    }

    public function failed(Throwable $exception): void
    {
        $run = $this->run->refresh();
        if ($run->state === Run::UPLOADING) {
            app(BackupService::class)->fail($run, 'The upload worker stopped: '.$exception->getMessage());
        }
    }
}
