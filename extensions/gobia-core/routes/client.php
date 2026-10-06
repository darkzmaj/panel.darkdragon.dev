<?php

use GobiaCore\Http\Controllers\ProfileController;
use Illuminate\Support\Facades\Route;

// Mounted at /api/client/extensions/gobia-core
Route::get('/profile', [ProfileController::class, 'show'])->name('profile');
Route::put('/profile/appearance', [ProfileController::class, 'updateAppearance'])->name('profile.appearance');
Route::post('/profile/avatar', [ProfileController::class, 'updateAvatar'])->name('profile.avatar');
Route::delete('/profile/avatar', [ProfileController::class, 'deleteAvatar'])->name('profile.avatar.delete');
Route::put('/profile/username', [ProfileController::class, 'updateUsername'])->name('profile.username');
