<?php

namespace Pterodactyl\Jobs;

use Illuminate\Support\Facades\Cache;
use Pterodactyl\Models\TemplateInstance;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\Attributes\WithoutRelations;
use Illuminate\Queue\Attributes\DeleteWhenMissingModels;
use Pterodactyl\Services\Templates\TemplateProvisioningService;

/**
 * Drives one template instance through the provisioning pipeline. Each run performs as many immediate steps as
 * it can and then re-queues itself with a delay while it waits (for example for the installation to finish), so
 * no worker is ever blocked for the duration of an install.
 */
#[DeleteWhenMissingModels]
class ProvisionTemplateInstanceJob implements ShouldQueue
{
    use Queueable;

    /** A single attempt: progress is stored in the instance state, and failures are recorded rather than retried blindly. */
    public int $tries = 1;

    public function __construct(
        #[WithoutRelations]
        public readonly TemplateInstance $instance,
    ) {
        // The Panel's workers listen on high, standard and low; the default queue is not processed.
        $this->onQueue('standard');
    }

    public function handle(TemplateProvisioningService $service): void
    {
        // Two workers must never advance the same instance at once (a duplicate dispatch would otherwise create two servers).
        $lock = Cache::lock('provision-template-instance:' . $this->instance->uuid, 300);
        if (!$lock->get()) {
            self::dispatch($this->instance)->delay(5);

            return;
        }

        try {
            $this->run($service);
        } finally {
            $lock->release();
        }
    }

    private function run(TemplateProvisioningService $service): void
    {
        // A bounded number of immediate steps per run guards against a bug turning into an endless loop.
        for ($i = 0; $i < 10; ++$i) {
            $delay = $service->advance($this->instance);
            if ($delay === null) {
                return;
            }
            if ($delay > 0) {
                self::dispatch($this->instance)->delay($delay);

                return;
            }
        }

        self::dispatch($this->instance)->delay(1);
    }

    public function failed(\Throwable $exception): void
    {
        $instance = $this->instance->refresh();
        if (!$instance->isFinished()) {
            app(TemplateProvisioningService::class)->fail($instance, $exception);
        }
    }
}
