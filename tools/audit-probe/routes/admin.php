<?php

use AuditProbe\Http\Controllers\ProbeController;
use Illuminate\Support\Facades\Route;

Route::get('/whoami', [ProbeController::class, 'whoami'])->name('whoami');
