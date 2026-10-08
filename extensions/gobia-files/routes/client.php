<?php

declare(strict_types=1);

use GobiaFiles\Http\Controllers\TransferController;
use Illuminate\Support\Facades\Route;

// Mounted at /api/client/extensions/gobia-files
Route::post('/transfers', [TransferController::class, 'store'])->name('transfers.store');
