<?php

namespace Pterodactyl\Services\Templates;

use Illuminate\Support\Arr;
use Illuminate\Support\Str;
use Pterodactyl\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Pterodactyl\Models\ServerTemplate;
use Illuminate\Support\Facades\RateLimiter;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Models\TemplateSftpCredential;

/**
 * SFTP access to a template's working files.
 *
 * The SFTP server is a separate process that never touches the Panel's database or key material. It asks the Panel
 * to check each login (authenticate()) and reports finished sessions (sessionEnded()). A credential opens one
 * template and nothing else; the secret is shown once at creation and stored hashed.
 */
class TemplateSftpService
{
    /** Failed logins allowed from one address, and for one username, before further attempts are refused. */
    public const MAX_FAILURES_PER_IP = 10;
    public const MAX_FAILURES_PER_USERNAME = 5;
    public const LOCKOUT_SECONDS = 900;

    public function __construct(private TemplateService $templates)
    {
    }

    /**
     * Creates a credential and returns it together with the plain secret, which cannot be retrieved afterwards.
     *
     * @return array{0: TemplateSftpCredential, 1: string}
     *
     * @throws DisplayException
     */
    public function create(ServerTemplate $template, ?User $by, string $permission, ?int $expiresInDays, ?string $label): array
    {
        if (!in_array($permission, [TemplateSftpCredential::READ_WRITE, TemplateSftpCredential::READ_ONLY], true)) {
            throw new DisplayException('Unknown permission.');
        }
        $max = (int) config('gobia_templates.sftp.max_credential_days');
        if ($expiresInDays !== null && ($expiresInDays < 1 || $expiresInDays > $max)) {
            throw new DisplayException("A credential can be valid for 1 to {$max} days.");
        }
        if ($template->sftpCredentials()->whereNull('revoked_at')->count() >= 25) {
            throw new DisplayException('This template already has 25 active credentials. Revoke some first.');
        }

        $password = Str::random(32);
        $credential = $template->sftpCredentials()->create([
            'created_by' => $by?->id,
            'label' => $label ? Str::limit($label, 80, '') : null,
            'username' => $this->newUsername(),
            'password_hash' => Hash::make($password),
            'permission' => $permission,
            'expires_at' => $expiresInDays ? now()->addDays($expiresInDays) : null,
        ]);

        return [$credential, $password];
    }

    public function revoke(TemplateSftpCredential $credential): void
    {
        if (!$credential->revoked_at) {
            $credential->forceFill(['revoked_at' => now()])->save();
        }
    }

    /**
     * Checks a login on behalf of the SFTP process. Returns what the process needs to open the session, or null.
     * Every attempt is logged, and repeated failures from one address or against one username are refused for a while.
     *
     * @return array{credential: int, template: string, permission: string, limits: array<string, int>}|null
     */
    public function authenticate(string $username, string $password, string $ip): ?array
    {
        $ipKey = 'template-sftp:ip:' . $ip;
        $userKey = 'template-sftp:user:' . strtolower($username);

        if (RateLimiter::tooManyAttempts($ipKey, self::MAX_FAILURES_PER_IP) || RateLimiter::tooManyAttempts($userKey, self::MAX_FAILURES_PER_USERNAME)) {
            $this->log('rate_limited', null, $username, $ip);

            return null;
        }

        $credential = TemplateSftpCredential::query()->where('username', $username)->first();

        // Always do the hash comparison, so a missing user costs the same time as a wrong password.
        $valid = Hash::check($password, $credential->password_hash ?? Hash::make(Str::random(16)));
        if (!$credential || !$valid || !$credential->isActive()) {
            RateLimiter::hit($ipKey, self::LOCKOUT_SECONDS);
            RateLimiter::hit($userKey, self::LOCKOUT_SECONDS);
            $this->log('login_failed', $credential, $username, $ip, $credential && $valid ? $credential->status() : null);

            return null;
        }

        RateLimiter::clear($userKey);
        $credential->forceFill(['last_used_at' => now(), 'last_used_ip' => $ip])->save();
        $this->log('login', $credential, $username, $ip);

        return [
            'credential' => $credential->id,
            'template' => $credential->template->uuid,
            'permission' => $credential->permission,
            'limits' => Arr::only((array) config('gobia_templates.limits'), ['max_file_bytes', 'max_total_bytes', 'max_files']),
        ];
    }

    /**
     * Called when a session ends. Marks the working tree as changed when something was written.
     */
    public function sessionEnded(int $credentialId, int $filesChanged, int $bytesWritten, string $ip): void
    {
        $credential = TemplateSftpCredential::query()->with('template')->find($credentialId);
        if (!$credential) {
            return;
        }
        if ($filesChanged > 0) {
            $this->templates->touchWorkingTree($credential->template);
        }
        $this->log('session_end', $credential, $credential->username, $ip, json_encode(['files_changed' => $filesChanged, 'bytes_written' => $bytesWritten]));
    }

    private function log(string $event, ?TemplateSftpCredential $credential, string $username, string $ip, ?string $detail = null): void
    {
        DB::table('template_sftp_events')->insert([
            'credential_id' => $credential?->id,
            'template_id' => $credential?->template_id,
            'username' => Str::limit($username, 60, ''),
            'event' => $event,
            'ip' => Str::limit($ip, 45, ''),
            'detail' => $detail ? Str::limit($detail, 500, '') : null,
            'created_at' => now(),
        ]);
    }

    private function newUsername(): string
    {
        do {
            $username = 'tpl_' . Str::lower(Str::random(10));
        } while (TemplateSftpCredential::query()->where('username', $username)->exists());

        return $username;
    }
}
