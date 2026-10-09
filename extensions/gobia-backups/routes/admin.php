<?php

declare(strict_types=1);

use GobiaBackups\Http\Controllers\DestinationController as D;
use GobiaBackups\Http\Controllers\PolicyController as P;
use GobiaBackups\Http\Controllers\RunController as R;
use Illuminate\Support\Facades\Route;
use Pterodactyl\Http\Middleware\Api\Admin\RequireSessionAuthentication;

// Mounted at /api/admin/extensions/gobia-backups (root administrators only).
Route::get('/destinations', [D::class, 'index'])->name('destinations');
Route::get('/policies', [P::class, 'index'])->name('policies');
Route::get('/servers/{server}/policy', [P::class, 'effective'])->whereUuid('server')->name('policies.effective');
Route::get('/runs', [R::class, 'index'])->name('runs');
Route::get('/restores', [R::class, 'restores'])->name('restores');
Route::post('/servers/{server}/backups', [R::class, 'store'])->whereUuid('server')->middleware('throttle:30,1')->name('runs.store');
Route::put('/policies', [P::class, 'put'])->name('policies.put');
Route::delete('/policies', [P::class, 'destroy'])->name('policies.destroy');

// Credentials, deletions and restores need a panel session: an API key is not enough for them.
Route::middleware(RequireSessionAuthentication::class)->group(function (): void {
    Route::post('/destinations/probe', [D::class, 'probe'])->middleware('throttle:20,1')->name('destinations.probe');
    Route::post('/destinations', [D::class, 'store'])->name('destinations.store');
    Route::patch('/destinations/{destination}', [D::class, 'update'])->whereNumber('destination')->name('destinations.update');
    Route::post('/destinations/{destination}/test', [D::class, 'test'])->whereNumber('destination')->middleware('throttle:20,1')->name('destinations.test');
    Route::delete('/destinations/{destination}', [D::class, 'destroy'])->whereNumber('destination')->name('destinations.destroy');
    Route::delete('/runs/{run}', [R::class, 'destroy'])->whereUuid('run')->name('runs.destroy');
    Route::post('/runs/{run}/restore', [R::class, 'restore'])->whereUuid('run')->middleware('throttle:10,1')->name('runs.restore');
});
