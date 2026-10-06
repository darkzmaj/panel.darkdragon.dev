<?php

use GobiaCore\Http\Controllers\CategoryController;
use GobiaCore\Http\Controllers\ProfileController;
use GobiaCore\Http\Controllers\ServerListController;
use Illuminate\Support\Facades\Route;

// Mounted at /api/client/extensions/gobia-core
Route::get('/profile', [ProfileController::class, 'show'])->name('profile');
Route::put('/profile/appearance', [ProfileController::class, 'updateAppearance'])->name('profile.appearance');
Route::post('/profile/avatar', [ProfileController::class, 'updateAvatar'])->name('profile.avatar');
Route::delete('/profile/avatar', [ProfileController::class, 'deleteAvatar'])->name('profile.avatar.delete');
Route::put('/profile/username', [ProfileController::class, 'updateUsername'])->name('profile.username');

Route::get('/servers', [ServerListController::class, 'index'])->name('servers');
Route::get('/servers/summary', [ServerListController::class, 'summary'])->name('servers.summary');
Route::put('/servers/order', [ServerListController::class, 'reorder'])->name('servers.order');
Route::put('/servers/{uuid}/icon-color', [ServerListController::class, 'iconColor'])->whereUuid('uuid')->name('servers.icon-color');

Route::post('/categories', [CategoryController::class, 'store'])->name('categories.store');
Route::put('/categories/order', [CategoryController::class, 'reorder'])->name('categories.order');
Route::put('/categories/{category}', [CategoryController::class, 'update'])->whereNumber('category')->name('categories.update');
Route::delete('/categories/{category}', [CategoryController::class, 'destroy'])->whereNumber('category')->name('categories.destroy');
Route::put('/categories/{category}/servers', [CategoryController::class, 'assign'])->whereNumber('category')->name('categories.assign');
Route::put('/categories/{category}/servers/{uuid}', [CategoryController::class, 'membership'])->whereNumber('category')->whereUuid('uuid')->name('categories.membership');
