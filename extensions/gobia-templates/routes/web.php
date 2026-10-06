<?php

declare(strict_types=1);

use GobiaTemplates\Http\Controllers\SftpServiceController as S;
use GobiaTemplates\Http\Middleware\RequireSftpServiceToken;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Route;

// Mounted at /extensions/gobia-templates. Called by the template SFTP process, never by a browser: no session or CSRF,
// authenticated by the shared service token instead.
Route::middleware([RequireSftpServiceToken::class, 'throttle:600,1'])->withoutMiddleware([PreventRequestForgery::class])->prefix('internal/sftp')->group(function (): void {
    Route::post('/authenticate', [S::class, 'authenticate'])->name('sftp.authenticate');
    Route::post('/session', [S::class, 'session'])->name('sftp.session');
});
