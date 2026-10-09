<?php

declare(strict_types=1);

use GobiaBackups\Http\Controllers\ServerBackupController as S;
use Illuminate\Support\Facades\Route;

// Mounted at /api/client/servers/{server}/extensions/gobia-backups, behind the same server access checks as core routes.
Route::get('/backups', [S::class, 'index'])->name('backups');
Route::post('/backups', [S::class, 'store'])->middleware('throttle:10,1')->name('backups.store');
Route::post('/backups/{run}/restore', [S::class, 'restore'])->whereUuid('run')->middleware('throttle:10,1')->name('backups.restore');
