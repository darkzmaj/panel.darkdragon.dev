<?php

declare(strict_types=1);

namespace GobiaBackups\Console;

use Cron\CronExpression;
use GobiaBackups\Models\Destination;
use GobiaBackups\Models\Policy;
use Illuminate\Console\Command;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\Server;

class PolicySetCommand extends Command
{
    protected $signature = 'gobia-backups:policy:set
        {--node= : Set the level of this node id instead of the global level}
        {--server= : Set the level of this server uuid instead of the global level}
        {--destination= : Destination id}
        {--enable : Switch scheduled backups on}
        {--disable : Switch scheduled backups off}
        {--cron= : When to back up, five cron fields, for example "0 4 * * *"}
        {--timezone= : Timezone the schedule is read in}
        {--keep-last= : How many backups to keep}
        {--keep-days= : Remove backups older than this many days}
        {--mirror=  : yes or no: also copy the backups people make themselves}';

    protected $description = 'Set the backup policy for everything, one node or one server. Options that are not given stay as they are.';

    public function handle(): int
    {
        $key = ['scope' => Policy::SCOPE_GLOBAL, 'node_id' => null, 'server_id' => null];
        if ($this->option('server')) {
            $key = ['scope' => Policy::SCOPE_SERVER, 'node_id' => null, 'server_id' => Server::query()->where('uuid', $this->option('server'))->firstOrFail()->id];
        } elseif ($this->option('node')) {
            $key = ['scope' => Policy::SCOPE_NODE, 'node_id' => Node::query()->findOrFail((int) $this->option('node'))->id, 'server_id' => null];
        }

        $fields = [];
        if ($this->option('destination')) {
            $fields['destination_id'] = Destination::query()->findOrFail((int) $this->option('destination'))->id;
        }
        if ($this->option('enable') || $this->option('disable')) {
            $fields['enabled'] = (bool) $this->option('enable');
        }
        if ($this->option('cron')) {
            if (! CronExpression::isValidExpression((string) $this->option('cron'))) {
                $this->error('That is not a valid cron expression.');

                return self::FAILURE;
            }
            $fields['cron'] = (string) $this->option('cron');
        }
        if ($this->option('timezone')) {
            if (! in_array($this->option('timezone'), timezone_identifiers_list(), true)) {
                $this->error('Unknown timezone.');

                return self::FAILURE;
            }
            $fields['timezone'] = (string) $this->option('timezone');
        }
        foreach (['keep-last' => 'keep_last', 'keep-days' => 'keep_days'] as $option => $field) {
            if ($this->option($option)) {
                $fields[$field] = max(1, (int) $this->option($option));
            }
        }
        if ($this->option('mirror')) {
            $fields['mirror_user_backups'] = in_array($this->option('mirror'), ['yes', 'true', '1'], true);
        }

        $policy = Policy::query()->where($key)->first() ?? new Policy($key);
        $policy->fill($fields)->save();
        $this->info(ucfirst($policy->scope).' level: '.json_encode($policy->overrides()));

        return self::SUCCESS;
    }
}
