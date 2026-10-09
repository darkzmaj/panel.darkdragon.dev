<?php

declare(strict_types=1);

namespace GobiaBackups\Console;

use GobiaBackups\Models\Destination;
use GobiaBackups\Models\Policy;
use GobiaBackups\Storage\StoreFactory;
use GobiaBackups\Support\StreamCipher;
use Illuminate\Console\Command;
use Throwable;

class DestinationAddCommand extends Command
{
    protected $signature = 'gobia-backups:destination:add
        {name : A name for this destination}
        {host : For example u123456-sub1.your-storagebox.de}
        {username : The Storage Box (sub) account}
        {--port=23 : 23 (SSH, with checksums) or 22 (plain SFTP)}
        {--key= : Path of the SSH private key file}
        {--base-path=gobia-backups : Folder inside the account}
        {--no-encrypt : Store archives as they are instead of encrypting them}
        {--fingerprint= : SHA256 host key fingerprint to pin without asking}
        {--default : Use this destination for every server (sets the global policy level)}';

    protected $description = 'Add a Storage Box as a backup destination, pin its host key and test it.';

    public function handle(StoreFactory $stores): int
    {
        $keyFile = (string) $this->option('key');
        $privateKey = $keyFile !== '' && is_file($keyFile) ? (string) file_get_contents($keyFile) : null;
        $password = $privateKey === null ? (string) $this->secret('No key file given. Storage Box password') : null;
        if ($privateKey === null && $password === '') {
            $this->error('An SSH key (--key=) or a password is needed.');

            return self::FAILURE;
        }

        $destination = new Destination([
            'name' => (string) $this->argument('name'),
            'host' => (string) $this->argument('host'),
            'port' => (int) $this->option('port'),
            'username' => (string) $this->argument('username'),
            'private_key' => $privateKey,
            'password' => $password,
            'base_path' => (string) $this->option('base-path'),
            'encrypt' => ! $this->option('no-encrypt'),
            'enabled' => true,
        ]);

        try {
            $probe = $stores->probe($destination);
            $presented = $probe->fingerprint();
            $probe->close();
        } catch (Throwable $exception) {
            $this->error('The server did not answer: '.$exception->getMessage());

            return self::FAILURE;
        }

        $pinned = (string) $this->option('fingerprint');
        if ($pinned === '') {
            $this->line('The server presents this host key: '.$presented);
            $this->line('Compare it with the fingerprint shown for the Storage Box in the Hetzner console.');
            if (! $this->confirm('Is it the same?')) {
                return self::FAILURE;
            }
            $pinned = $presented;
        } elseif (! hash_equals($pinned, $presented)) {
            $this->error('The server presents '.$presented.', not the fingerprint that was given. Nothing was saved.');

            return self::FAILURE;
        }
        $destination->host_key_fingerprint = $pinned;

        $key = $destination->encrypt ? base64_encode(StreamCipher::generateKey()) : null;
        $destination->encryption_key = $key;

        try {
            $store = $stores->open($destination);
            $store->makeDirectory('.');
            $store->close();
        } catch (Throwable $exception) {
            $this->error('Logging in failed: '.$exception->getMessage());

            return self::FAILURE;
        }

        $destination->last_checked_at = now();
        $destination->save();
        if ($this->option('default')) {
            Policy::query()->updateOrCreate(['scope' => Policy::SCOPE_GLOBAL, 'node_id' => null, 'server_id' => null], ['destination_id' => $destination->id]);
        }

        $this->info('Destination "'.$destination->name.'" saved (id '.$destination->id.').');
        if ($key !== null) {
            $this->warn('Encryption key (shown only now). Store it somewhere safe that is NOT this server:');
            $this->line($key);
            $this->line('Without it the backups on this destination cannot be read if the Panel is lost.');
        }

        return self::SUCCESS;
    }
}
