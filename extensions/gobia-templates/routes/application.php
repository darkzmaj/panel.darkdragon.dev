<?php

declare(strict_types=1);

use GobiaTemplates\Http\Controllers\ApplicationTemplateController as A;
use Illuminate\Support\Facades\Route;

// Mounted at /api/application/extensions/gobia-templates. Needs an application API key with servers permission.
Route::get('/templates', [A::class, 'index'])->name('index');
Route::get('/templates/{template}', [A::class, 'view'])->whereNumber('template')->name('view');
Route::post('/templates/{template}/instances', [A::class, 'store'])->whereNumber('template')->name('instances.store');
Route::get('/templates/{template}/instances/{instance}', [A::class, 'viewInstance'])->whereNumber('template')->whereUuid('instance')->name('instances.view');
Route::post('/templates/{template}/instances/{instance}/retry', [A::class, 'retry'])->whereNumber('template')->whereUuid('instance')->name('instances.retry');
Route::delete('/templates/{template}/instances/{instance}', [A::class, 'destroy'])->whereNumber('template')->whereUuid('instance')->name('instances.destroy');
