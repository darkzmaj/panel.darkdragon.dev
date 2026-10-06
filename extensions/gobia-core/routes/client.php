<?php

use GobiaCore\Http\Controllers\ProfileController;
use Illuminate\Support\Facades\Route;

// Mounted at /api/client/extensions/gobia-core
Route::get('/profile', [ProfileController::class, 'show'])->name('profile');
Route::put('/profile/appearance', [ProfileController::class, 'updateAppearance'])->name('profile.appearance');
