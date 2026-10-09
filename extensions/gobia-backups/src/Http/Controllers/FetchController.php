<?php

declare(strict_types=1);

namespace GobiaBackups\Http\Controllers;

use GobiaBackups\Models\Restore;
use GobiaBackups\Services\RestoreService;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Where Wings downloads the archive of a restore from. There is no session here: the request is authorised by the
 * signature of the link (made with the Panel key, valid for minutes, bound to one restore) and only answers
 * while that restore is waiting for its download.
 */
class FetchController
{
    public function __invoke(RestoreService $restores, string $restore): StreamedResponse
    {
        $model = Restore::query()->where('uuid', $restore)->whereIn('state', [Restore::REQUESTED, Restore::STREAMING])->first();
        if ($model === null) {
            throw new NotFoundHttpException;
        }

        @set_time_limit(0);

        return new StreamedResponse(function () use ($restores, $model): void {
            $restores->stream($model, function (string $bytes): void {
                echo $bytes;
                if (ob_get_level() > 0) {
                    @ob_flush();
                }
                flush();
            });
        }, 200, [
            // Wings only accepts a gzip archive from a restore link.
            'Content-Type' => 'application/x-gzip',
            'Content-Length' => (string) $model->run->bytes,
            'Content-Disposition' => 'attachment; filename="'.$model->run->uuid.'.tar.gz"',
            'Cache-Control' => 'no-store',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
