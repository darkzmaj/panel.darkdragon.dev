<?php

namespace Pterodactyl\Providers;

use Illuminate\Support\ServiceProvider;
use Pterodactyl\Services\Updater\RunStore;
use Pterodactyl\Services\Updater\ProcessRunner;
use Pterodactyl\Services\Updater\ReleaseVerifier;
use Pterodactyl\Services\Updater\SafeTarExtractor;
use Pterodactyl\Services\Updater\Runners\InPlaceRunner;
use Pterodactyl\Services\Updater\Runners\DeploymentRunner;
use Pterodactyl\Services\Updater\Providers\ReleaseProvider;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;
use Pterodactyl\Services\Updater\Runners\ReleaseDirectoryRunner;
use Pterodactyl\Services\Updater\Providers\GitHubReleaseProvider;
use Pterodactyl\Services\Updater\Providers\DirectoryReleaseProvider;
use Illuminate\Foundation\Http\Middleware\PreventRequestsDuringMaintenance;

class UpdaterServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(RunStore::class, fn () => new RunStore((string) config('gobia.update.state_path')));
        $this->app->singleton(ProcessRunner::class);

        $this->app->singleton(ReleaseVerifier::class, fn () => new ReleaseVerifier(config('gobia.update.public_key') ?: null));

        $this->app->singleton(SafeTarExtractor::class, fn () => new SafeTarExtractor(
            (int) config('gobia.update.max_extracted_bytes'),
            (int) config('gobia.update.max_archive_entries'),
        ));

        // The source is chosen by the operator in configuration. There is deliberately no way to pick it per request.
        $this->app->singleton(ReleaseProvider::class, fn () => match (config('gobia.update.provider')) {
            'github' => new GitHubReleaseProvider(
                (string) config('gobia.update.repository'),
                config('gobia.update.github_token') ?: null,
                (int) config('gobia.update.max_download_bytes'),
            ),
            'directory' => new DirectoryReleaseProvider((string) config('gobia.update.directory')),
            default => throw new UpdateException('The configured update provider is not supported.'),
        });

        $this->app->singleton(DeploymentRunner::class, fn ($app) => match (config('gobia.update.runner')) {
            'in-place' => new InPlaceRunner($app->make(ProcessRunner::class)),
            'release-directory' => new ReleaseDirectoryRunner(
                $app->make(ProcessRunner::class),
                (string) config('gobia.update.install_root'),
                (string) config('gobia.update.helper'),
            ),
            default => throw new UpdateException('The configured update runner is not supported.'),
        });
    }

    public function boot(): void
    {
        // The maintenance page polls this endpoint, and it has to answer while an update is running.
        PreventRequestsDuringMaintenance::except(['system/update-progress']);
    }
}
