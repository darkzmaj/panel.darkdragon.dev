<?php

use Illuminate\Support\Facades\Route;
use Pterodactyl\Http\Controllers\Api\Internal;

// Used by the template SFTP process only. Every request needs the shared service token.
Route::post('/template-sftp/authenticate', [Internal\TemplateSftpController::class, 'authenticate']);
Route::post('/template-sftp/session', [Internal\TemplateSftpController::class, 'session']);
