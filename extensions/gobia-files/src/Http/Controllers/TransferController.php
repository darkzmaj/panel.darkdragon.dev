<?php

declare(strict_types=1);

namespace GobiaFiles\Http\Controllers;

use GobiaFiles\Services\TransferService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Support\Facades\Cache;
use Pterodactyl\Facades\Activity;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;

#[Group('Gobia files')]
class TransferController
{
    public function __construct(private readonly TransferService $transfers) {}

    #[Endpoint('Copy or move files between two servers', 'Copies (default) or moves files and folders from a server the signed in user can read to a server they can write to. The Panel carries the bytes; every file is verified before a move removes its source.')]
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'source' => ['required', 'string', 'uuid'],
            'destination' => ['required', 'string', 'uuid'],
            'directory' => ['required', 'string', 'max:4096'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*' => ['required', 'string', 'max:4096'],
            'mode' => ['sometimes', 'string', Rule::in(['copy', 'move'])],
            'conflict' => ['sometimes', 'string', Rule::in(['replace', 'keep', 'skip'])],
            'kinds' => ['sometimes', 'array', 'max:200'],
            'kinds.*' => ['string', Rule::in(['file', 'directory'])],
            'resume' => ['sometimes', 'boolean'],
        ]);
        $user = $request->user();
        $mode = $data['mode'] ?? 'copy';

        // A transfer holds a PHP worker and temporary disk for as long as it runs, so one person only gets a few at once.
        $slot = $this->slot($user->id);
        if ($slot === null) {
            throw new TooManyRequestsHttpException(5, 'You already have transfers running. Wait for one to finish.');
        }

        try {
            $result = $this->transfers->transfer(
                $user,
                $data['source'],
                $data['destination'],
                $data['directory'],
                array_values($data['items']),
                $mode,
                $data['conflict'] ?? 'skip',
                $data['kinds'] ?? [],
                (bool) ($data['resume'] ?? false),
            );
        } finally {
            $slot->release();
        }

        $failed = count(array_filter($result['items'], fn (array $item): bool => $item['status'] === 'failed'));
        Activity::event('gobia:file.transfer')
            ->subject($result['source'], $result['destination'])
            ->property([
                'mode' => $mode,
                'source' => $result['source']->uuid,
                'destination' => $result['destination']->uuid,
                'directory' => $result['directory'],
                'items' => count($data['items']),
                'failed' => $failed,
            ])
            ->log();

        return new JsonResponse([
            'mode' => $mode,
            'directory' => $result['directory'],
            'items' => $result['items'],
            'bytes' => $result['bytes'],
            'timings' => $result['timings'],
        ]);
    }

    /** One of the user's transfer slots, or null when all are taken. A slot frees itself if the request dies. */
    private function slot(int $userId): ?Lock
    {
        $seconds = (int) config('gobia_files.transfer.timeout') * 2;
        for ($index = 0; $index < (int) config('gobia_files.transfer.concurrent_per_user', 2); $index++) {
            $lock = Cache::lock('gobia-files:transfer:'.$userId.':'.$index, $seconds);
            if ($lock->get()) {
                return $lock;
            }
        }

        return null;
    }
}
