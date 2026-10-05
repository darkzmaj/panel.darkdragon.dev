# Production performance settings

Starting points, not guarantees. Size workers from measurements on your hardware.

## PHP-FPM and OPcache

OPcache is the largest single factor: with it, a typical authenticated API request on the Panel took 20 to 45 ms instead of 160 to 260 ms in our
tests (debug off, Clockwork off, OPcache on).

```ini
; php.ini / conf.d/10-opcache.ini
opcache.enable=1
opcache.memory_consumption=192
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=20000
opcache.validate_timestamps=0      ; reload PHP-FPM on every release (the updater does)
opcache.save_comments=1
realpath_cache_size=4096K
realpath_cache_ttl=600
memory_limit=256M
```

```ini
; www.conf: start from cores x 2 for a mostly I/O bound panel and measure
pm = dynamic
pm.max_children = 16
pm.start_servers = 4
pm.min_spare_servers = 2
pm.max_spare_servers = 6
pm.max_requests = 500
```

Do not set `pm.max_children` by guesswork: each child needs roughly 40 to 80 MB. Watch memory under load.

## Laravel caches (every release)

```bash
php artisan config:cache && php artisan route:cache && php artisan view:cache && php artisan event:cache
sudo systemctl reload php8.3-fpm
```

Run them after the code is in place and before traffic returns. The one-click updater must run the same commands and reload PHP-FPM after
the files change; verify this on the first release after enabling `validate_timestamps=0`. `.env` is ignored while the config is cached, so
clear it (`php artisan config:clear`) before editing environment values.

## Redis

Use Redis for cache, queue and (optionally) sessions. Authorization is never cached.

```env
CACHE_DRIVER=redis
QUEUE_CONNECTION=redis
SESSION_DRIVER=redis        # optional; file sessions are fine on one machine
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

Queue workers: one supervisor program per queue is enough to start (`php artisan queue:work --queue=high,standard,low --tries=3`), two or more
processes if provisioning or backups queue up. With the Redis driver a job starts in milliseconds; the database driver polls and adds up to the
`--sleep` value. Restart workers on every release (`php artisan queue:restart`). Redis was not available on the development machine, so this
configuration is documented but was not benchmarked.

## Nginx

```nginx
server {
    listen 443 ssl http2;
    listen 443 quic reuseport;            # optional HTTP/3; the site works without it
    add_header Alt-Svc 'h3=":443"; ma=86400' always;

    root /var/www/panel/public;
    index index.php;

    gzip on;
    gzip_comp_level 5;
    gzip_types text/css application/javascript application/json image/svg+xml;
    # brotli on; brotli_comp_level 5; brotli_types ...;   # when the module is installed

    # Hashed build output never changes under the same name.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
    # Theme files carry a ?v= version; fonts and logos rarely change.
    location /themes/ {
        expires 30d;
        add_header Cache-Control "public";
        try_files $uri =404;
    }
    # Uploaded avatars and branding are versioned by hash in their URL.
    location ~ ^/(storage|avatars|branding)/ {
        expires 30d;
        add_header Cache-Control "public";
        try_files $uri =404;
    }

    location / { try_files $uri $uri/ /index.php?$query_string; }
    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        fastcgi_keep_conn on;
    }
}
```

The measured numbers earlier in `docs/performance-phase3-redesign.md` are uncompressed; with gzip or Brotli the JavaScript transfer is roughly a
third of its size.

## Server-Timing and debugging

Leave `GOBIA_SERVER_TIMING` unset in production (it defaults to `APP_DEBUG`). Set it to `true` temporarily to see where a request spends its time
in the browser's network panel. `GOBIA_QUERY_LOG` is for development only. If Clockwork is installed, set `CLOCKWORK_SERVER_TIMING=false`
so it does not overwrite the header.

## Wings side (proposals for a later phase, nothing changed here)

Candidates to profile in a Gobia Wings fork: a batched file-write endpoint for template deployment, a stats stream for many servers in one call
instead of one request each, publishing container state transitions with timestamps (to fill the start timeline), and a native readiness probe.
No Wings code was modified in Phase 4.
