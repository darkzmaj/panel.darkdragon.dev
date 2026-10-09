<?php

declare(strict_types=1);

use GobiaCore\Http\Controllers\CompatibilityController;
use GobiaCore\Http\Controllers\OverviewController;
use GobiaCore\Http\Controllers\UpdateController;
use Illuminate\Support\Facades\Route;
use Pterodactyl\Http\Middleware\Api\Admin\RequireSessionAuthentication;

// Mounted at /api/admin/extensions/gobia-core (root administrators only)
Route::get('/overview', OverviewController::class)->name('overview');
Route::get('/compatibility', CompatibilityController::class)->name('compatibility');

// Gobia Updates (docs/gobia-updates-frontend-contract.md). Reading is open to any root administrator
// credential; installing and rolling back need a panel session and are rate limited separately.
Route::prefix('/updates')->name('updates.')->group(function (): void {
    Route::get('/check', [UpdateController::class, 'check'])->name('check');
    Route::get('/preflight', [UpdateController::class, 'preflight'])->name('preflight');
    Route::get('/progress/{update}', [UpdateController::class, 'progress'])->where('update', '[0-9]{8}T[0-9]{6}-[a-z0-9]{6}')->name('progress');
    Route::get('/history', [UpdateController::class, 'history'])->name('history');
    Route::get('/rollback-eligibility', [UpdateController::class, 'rollbackEligibility'])->name('rollback-eligibility');

    Route::middleware([RequireSessionAuthentication::class, 'throttle:6,1'])->group(function (): void {
        Route::post('/install', [UpdateController::class, 'install'])->name('install');
        Route::post('/rollback', [UpdateController::class, 'rollback'])->name('rollback');
    });
});
