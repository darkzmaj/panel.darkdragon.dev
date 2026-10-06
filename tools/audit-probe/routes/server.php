<?php

use AuditProbe\Http\Controllers\ProbeController;
use Illuminate\Support\Facades\Route;

Route::get('/items', [ProbeController::class, 'items'])->name('items');
Route::post('/items', [ProbeController::class, 'store'])->name('store');
Route::get('/setting', [ProbeController::class, 'serverSetting'])->name('server-setting');
