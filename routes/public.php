<?php

use Illuminate\Support\Facades\Route;
use Pterodactyl\Http\Controllers\Base;

/*
|--------------------------------------------------------------------------
| Public Routes
|--------------------------------------------------------------------------
|
| Registered outside the "web" group on purpose: no session, no cookies and no
| authentication. They serve cacheable branding images and the coarse update progress
| shown on the maintenance page, so they must keep working during an update.
*/

Route::get('/branding/logo', [Base\BrandingAssetController::class, 'logo'])->name('branding.logo');
Route::get('/branding/favicon', [Base\BrandingAssetController::class, 'favicon'])->name('branding.favicon');
Route::get('/system/update-progress', Base\UpdateProgressController::class)->name('system.update-progress');
