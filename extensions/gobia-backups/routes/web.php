<?php

declare(strict_types=1);

use GobiaBackups\Http\Controllers\FetchController;
use Illuminate\Support\Facades\Route;

// Mounted at /extensions/gobia-backups. Called by Wings during a restore, never by a browser: authorised by the
// signature of the link, which the Panel only ever hands to a node.
Route::get('/fetch/{restore}', FetchController::class)->whereUuid('restore')->middleware(['signed', 'throttle:30,1'])->name('fetch');
