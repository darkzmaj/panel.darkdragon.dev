<?php

namespace Pterodactyl\Console\Commands\Maintenance;

use Illuminate\Console\Command;
use Pterodactyl\Models\TemplateInstance;
use Pterodactyl\Services\Templates\TemplateInstanceService;

/**
 * Removes the servers of temporary template instances whose time to live has passed.
 */
class ExpireTemplateInstancesCommand extends Command
{
    protected $signature = 'p:maintenance:expire-template-instances';

    protected $description = 'Delete servers created from temporary templates once their time to live has passed.';

    public function handle(TemplateInstanceService $instances): int
    {
        $expired = TemplateInstance::query()
            ->with(['template', 'server'])
            ->where('state', TemplateInstance::STATE_READY)
            ->whereNotNull('expires_at')
            ->where('expires_at', '<=', now())
            ->get();

        foreach ($expired as $instance) {
            try {
                // Expiry is the template's own lifecycle rule, so it is not subject to the API deletion switch.
                $instances->destroy($instance, true);
                $this->line("Removed expired instance {$instance->uuid}.");
            } catch (\Throwable $exception) {
                report($exception);
                $this->error("Could not remove {$instance->uuid}: {$exception->getMessage()}");
            }
        }

        return Command::SUCCESS;
    }
}
