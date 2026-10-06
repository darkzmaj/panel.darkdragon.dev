<?php

declare(strict_types=1);

use GobiaCore\Http\Controllers\OverviewController;
use Illuminate\Support\Facades\Route;

// Mounted at /api/admin/extensions/gobia-core (root administrators only)
Route::get('/overview', OverviewController::class)->name('overview');
