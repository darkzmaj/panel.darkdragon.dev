<?php

declare(strict_types=1);

use GobiaTemplates\Http\Controllers\AdminTemplateController as T;
use Illuminate\Support\Facades\Route;

// Mounted at /api/admin/extensions/gobia-templates (root administrators only)
Route::get('/options', [T::class, 'options'])->name('options');
Route::get('/templates', [T::class, 'index'])->name('index');
Route::post('/templates', [T::class, 'store'])->name('store');
Route::get('/templates/{template}', [T::class, 'show'])->whereNumber('template')->name('show');
Route::patch('/templates/{template}', [T::class, 'update'])->whereNumber('template')->name('update');
Route::delete('/templates/{template}', [T::class, 'destroy'])->whereNumber('template')->name('destroy');
Route::post('/templates/{template}/duplicate', [T::class, 'duplicate'])->whereNumber('template')->name('duplicate');
Route::post('/templates/{template}/toggle', [T::class, 'toggle'])->whereNumber('template')->name('toggle');
Route::post('/templates/{template}/publish', [T::class, 'publish'])->whereNumber('template')->name('publish');

Route::get('/templates/{template}/revisions', [T::class, 'revisions'])->whereNumber('template')->name('revisions');

Route::get('/templates/{template}/files', [T::class, 'files'])->whereNumber('template')->name('files');
Route::get('/templates/{template}/files/content', [T::class, 'readFile'])->whereNumber('template')->name('files.read');
// File content is exact; the provider exempts this request from TrimStrings.
Route::put('/templates/{template}/files', [T::class, 'writeFile'])->whereNumber('template')->name('files.write');
Route::delete('/templates/{template}/files', [T::class, 'deleteFile'])->whereNumber('template')->name('files.delete');
Route::put('/templates/{template}/files/upload', [T::class, 'uploadFile'])->whereNumber('template')->name('files.upload');
Route::post('/templates/{template}/files/folder', [T::class, 'makeFolder'])->whereNumber('template')->name('files.folder');
Route::post('/templates/{template}/files/move', [T::class, 'moveFile'])->whereNumber('template')->name('files.move');
Route::get('/templates/{template}/files/download', [T::class, 'downloadFile'])->whereNumber('template')->name('files.download');

Route::get('/templates/{template}/sftp', [T::class, 'sftpIndex'])->whereNumber('template')->name('sftp');
Route::post('/templates/{template}/sftp', [T::class, 'sftpCreate'])->whereNumber('template')->middleware('throttle:20,1')->name('sftp.create');
Route::delete('/templates/{template}/sftp/{credential}', [T::class, 'sftpRevoke'])->whereNumber(['template', 'credential'])->name('sftp.revoke');

Route::post('/templates/{template}/instances', [T::class, 'instanceStore'])->whereNumber('template')->middleware('throttle:20,1')->name('instances.store');
Route::get('/templates/{template}/instances/{instance}', [T::class, 'instanceStatus'])->whereNumber('template')->whereUuid('instance')->name('instances.status');
Route::post('/templates/{template}/instances/{instance}/retry', [T::class, 'instanceRetry'])->whereNumber('template')->whereUuid('instance')->name('instances.retry');
