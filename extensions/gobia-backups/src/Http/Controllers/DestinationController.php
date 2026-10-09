<?php

declare(strict_types=1);

namespace GobiaBackups\Http\Controllers;

use GobiaBackups\Models\Destination;
use GobiaBackups\Models\Run;
use GobiaBackups\Storage\StoreFactory;
use GobiaBackups\Support\StreamCipher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;
use Pterodactyl\Facades\Activity;
use Throwable;

/**
 * Storage Box destinations. Administrators only. Secrets go in and never come out: responses say whether a key
 * or password is set, not what it is. The one exception is the encryption key, shown once when it is generated,
 * because without an offline copy of it the backups are lost together with the Panel.
 */
#[Group('Gobia backups')]
class DestinationController
{
    public function __construct(private readonly StoreFactory $stores) {}

    #[Endpoint('List backup destinations')]
    public function index(): JsonResponse
    {
        return new JsonResponse(['data' => Destination::query()->orderBy('name')->get()->map(fn (Destination $destination): array => $destination->summary())->all()]);
    }

    #[Endpoint('Read a host key', 'Connects without logging in and returns the fingerprint of the host key the server presents, to be compared with the one Hetzner publishes before it is pinned.')]
    public function probe(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules(['host', 'port']));
        $store = $this->stores->probe(new Destination(['host' => $data['host'], 'port' => $data['port'] ?? 23]));

        try {
            return new JsonResponse(['host_key_fingerprint' => $store->fingerprint()]);
        } catch (Throwable $exception) {
            throw ValidationException::withMessages(['host' => Str::limit($exception->getMessage(), 200)]);
        } finally {
            rescue(fn () => $store->close(), report: false);
        }
    }

    #[Endpoint('Add a backup destination')]
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules(['name', 'host', 'port', 'username', 'private_key', 'password', 'host_key_fingerprint', 'base_path', 'encrypt', 'enabled'], creating: true));
        if (empty($data['private_key']) && empty($data['password'])) {
            throw ValidationException::withMessages(['private_key' => 'Give an SSH private key (preferred) or a password.']);
        }

        $encrypt = (bool) ($data['encrypt'] ?? true);
        $key = $encrypt ? base64_encode(StreamCipher::generateKey()) : null;
        $destination = Destination::query()->create([
            'name' => $data['name'],
            'host' => $data['host'],
            'port' => $data['port'] ?? 23,
            'username' => $data['username'],
            'private_key' => $data['private_key'] ?? null,
            'password' => $data['password'] ?? null,
            'host_key_fingerprint' => $data['host_key_fingerprint'],
            'base_path' => $data['base_path'] ?? 'gobia-backups',
            'encrypt' => $encrypt,
            'encryption_key' => $key,
            'enabled' => (bool) ($data['enabled'] ?? true),
        ]);
        Activity::event('gobia:backup.destination-created')->property(['destination' => $destination->name, 'host' => $destination->host])->log();

        // Shown this once. It is needed to decrypt backups without this Panel (bin/decrypt.php).
        return new JsonResponse($destination->summary() + ['encryption_key' => $key], 201);
    }

    #[Endpoint('Change a backup destination', 'A key or password that is sent replaces the stored one; leaving it out keeps it.')]
    public function update(Request $request, int $destination): JsonResponse
    {
        $model = Destination::query()->findOrFail($destination);
        $data = $request->validate($this->rules(['name', 'host', 'port', 'username', 'private_key', 'password', 'host_key_fingerprint', 'base_path', 'enabled'], ignore: $model->id));

        // Pointing a destination at another server needs that server's key pinned in the same request.
        if (isset($data['host']) && $data['host'] !== $model->host && ! isset($data['host_key_fingerprint'])) {
            throw ValidationException::withMessages(['host_key_fingerprint' => 'Pin the host key of the new host.']);
        }

        foreach (['private_key', 'password'] as $secret) {
            if (array_key_exists($secret, $data) && $data[$secret] === null) {
                unset($data[$secret]);
            }
        }
        $model->fill($data)->save();
        Activity::event('gobia:backup.destination-updated')->property(['destination' => $model->name, 'changed' => array_values(array_diff(array_keys($data), ['private_key', 'password']))])->log();

        return new JsonResponse($model->summary());
    }

    #[Endpoint('Test a backup destination', 'Logs in with the pinned host key, writes, checks and removes a small object.')]
    public function test(int $destination): JsonResponse
    {
        $model = Destination::query()->findOrFail($destination);
        $store = $this->stores->open($model);
        $path = '.gobia-test-'.Str::lower(Str::random(12));
        $payload = random_bytes(4096);

        try {
            $sent = false;
            $store->makeDirectory('.');
            $store->put($path, function () use ($payload, &$sent): ?string {
                if ($sent) {
                    return null;
                }
                $sent = true;

                return $payload;
            });
            $sizeOk = $store->size($path) === strlen($payload);
            $remote = $store->sha256($path);
            $store->delete($path);
            if (! $sizeOk || ($remote !== null && ! hash_equals(hash('sha256', $payload), $remote))) {
                throw new \RuntimeException('The test object did not read back as written.');
            }
            $model->forceFill(['last_checked_at' => now(), 'last_error' => null])->save();

            return new JsonResponse(['ok' => true, 'checksum_supported' => $remote !== null, 'host_key_fingerprint' => $store->fingerprint()]);
        } catch (Throwable $exception) {
            $model->forceFill(['last_checked_at' => now(), 'last_error' => Str::limit($exception->getMessage(), 480)])->save();

            return new JsonResponse(['ok' => false, 'error' => $model->last_error], 422);
        } finally {
            rescue(fn () => $store->close(), report: false);
        }
    }

    #[Endpoint('Remove a backup destination', 'Refused while backups are stored on it.')]
    public function destroy(int $destination): JsonResponse
    {
        $model = Destination::query()->findOrFail($destination);
        if (Run::query()->where('destination_id', $model->id)->whereNotIn('state', [Run::DELETED, Run::FAILED])->exists()) {
            return new JsonResponse(['errors' => [['code' => 'destination_in_use', 'status' => '409', 'detail' => 'Backups are stored on this destination. Remove them first, or disable the destination instead.']]], 409);
        }
        Run::query()->where('destination_id', $model->id)->delete();
        $model->delete();
        Activity::event('gobia:backup.destination-deleted')->property(['destination' => $model->name])->log();

        return new JsonResponse([], 204);
    }

    /**
     * @param  list<string>  $fields
     * @return array<string, list<mixed>>
     */
    private function rules(array $fields, bool $creating = false, ?int $ignore = null): array
    {
        $required = $creating ? 'required' : 'sometimes';
        $all = [
            'name' => [$required, 'string', 'min:1', 'max:80', Rule::unique('gobia_backup_destinations', 'name')->ignore($ignore)],
            // A host name or address, nothing that could carry a path, a user or an option.
            'host' => [$creating || $fields === ['host', 'port'] ? 'required' : 'sometimes', 'string', 'max:191', 'regex:/\A[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\z/'],
            'port' => ['sometimes', 'integer', 'min:1', 'max:65535'],
            'username' => [$required, 'string', 'max:64', 'regex:/\A[A-Za-z0-9][A-Za-z0-9._-]*\z/'],
            'private_key' => ['sometimes', 'nullable', 'string', 'max:16384', 'starts_with:-----BEGIN'],
            'password' => ['sometimes', 'nullable', 'string', 'max:255'],
            'host_key_fingerprint' => [$required, 'string', 'regex:/\ASHA256:[A-Za-z0-9+\/]{43}\z/'],
            'base_path' => ['sometimes', 'string', 'max:191', 'regex:/\A[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*\z/'],
            'encrypt' => ['sometimes', 'boolean'],
            'enabled' => ['sometimes', 'boolean'],
        ];

        return array_intersect_key($all, array_flip($fields));
    }
}
