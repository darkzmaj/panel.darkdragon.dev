<?php

use AuditProbe\Http\Controllers\ProbeController;
use Illuminate\Support\Facades\Route;

Route::get('/status', [ProbeController::class, 'status'])->name('status');
Route::get('/me/setting', [ProbeController::class, 'userSetting'])->name('user-setting');
Route::put('/me/setting', [ProbeController::class, 'putUserSetting'])->name('put-user-setting');
Route::post('/job', [ProbeController::class, 'job'])->name('job');
