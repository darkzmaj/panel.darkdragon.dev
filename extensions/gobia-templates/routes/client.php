<?php

declare(strict_types=1);

use GobiaTemplates\Http\Controllers\TemplateBrowserController as B;
use Illuminate\Support\Facades\Route;

// Mounted at /api/client/extensions/gobia-templates. The controller rejects everyone except administrators.
Route::get('/templates', [B::class, 'index'])->name('index');
Route::get('/owners', [B::class, 'owners'])->name('owners');
Route::get('/templates/{template}', [B::class, 'show'])->whereNumber('template')->name('show');
Route::post('/templates/{template}/instances', [B::class, 'store'])->whereNumber('template')->middleware('throttle:20,1')->name('store');
Route::get('/templates/{template}/instances/{instance}', [B::class, 'status'])->whereNumber('template')->whereUuid('instance')->name('status');
