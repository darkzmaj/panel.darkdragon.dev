<?php

use Illuminate\Support\Facades\Route;
use Pterodactyl\Http\Controllers\Base;

Route::get('/branding/logo', [Base\BrandingAssetController::class, 'logo'])->name('branding.logo');
Route::get('/branding/favicon', [Base\BrandingAssetController::class, 'favicon'])->name('branding.favicon');
