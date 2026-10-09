<?php

declare(strict_types=1);

namespace GobiaCore\Console;

/** The updater's artisan commands, registered together by the provider. */
final class UpdateCommands
{
    /** @var list<class-string> */
    public const array ALL = [
        Update\UpdateCheckCommand::class,
        Update\UpdateRunCommand::class,
        Update\UpdateWorkCommand::class,
        Update\UpdateRecoverCommand::class,
        Update\UpdateRollbackCommand::class,
        Update\UpdateHealthCommand::class,
        Update\UpdateFinalizeCommand::class,
    ];
}
