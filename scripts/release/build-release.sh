#!/usr/bin/env bash
# Builds the deployable, signed Gobia release package for the version in gobia-release.json.
#
#   scripts/release/build-release.sh [output-dir]
#
# Prerequisites: the frontend is built (npm run build:production, then node scripts/gobia/run.mjs build),
# composer and php are on PATH, and GOBIA_RELEASE_SIGNING_KEY (or GOBIA_RELEASE_SIGNING_KEY_FILE) holds the
# Ed25519 signing key.
# Optional: COMPOSER_EXTRA_ARGS (for example --ignore-platform-req=ext-posix on Windows),
#           RELEASE_VERSION overrides gobia_version inside the package (local update testing only),
#           RELEASE_DESTRUCTIVE=true marks the release as containing a destructive migration,
#           RELEASE_EXTRA_DIR=<dir> is copied over the package (local testing only),
#           RELEASE_SOURCE=worktree packages the working tree instead of HEAD (local testing only).
#
# Output: <out>/<version>/{gobia-panel-<version>.tar.gz, release.json, gobia-panel-<version>.tar.gz.sha256},
# which is also the layout GOBIA_UPDATE_PROVIDER=directory reads.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/dist}"
VERSION="${RELEASE_VERSION:-$(php -r 'echo json_decode(file_get_contents($argv[1]), true)["gobia_version"] ?? "";' "$ROOT/gobia-release.json")}"

if ! [[ "$VERSION" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-(dev|alpha|beta|rc)(\.[0-9]{1,4})?)?$ ]]; then
    echo "Invalid version: $VERSION" >&2
    exit 1
fi
if [ ! -f "$ROOT/public/assets/manifest.json" ]; then
    echo "public/assets is missing; run 'npm run build:production' first." >&2
    exit 1
fi
for extension in "$ROOT"/extensions/gobia-*/; do
    if [ -f "$extension/vite.config.mjs" ] && [ ! -f "$extension/dist/client.js" ]; then
        echo "$(basename "$extension") is not built; run 'node scripts/gobia/run.mjs build' first." >&2
        exit 1
    fi
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Tracked files only, so no local state can leak in. Build output is not tracked and is copied explicitly.
if [ "${RELEASE_SOURCE:-head}" = "worktree" ]; then
    # Local update testing only: the working tree as it is (tracked and new files, nothing that is ignored).
    (cd "$ROOT" && git ls-files -co --exclude-standard -z | tar --null -T - -cf - 2>/dev/null) | tar -x -C "$STAGE"
else
    git -C "$ROOT" archive HEAD | tar -x -C "$STAGE"
fi
mkdir -p "$STAGE/public/assets"
cp -r "$ROOT/public/assets/." "$STAGE/public/assets/"
# Published copies of a developer's extensions and theme are local state; the updater publishes them again.
rm -rf "$STAGE/public/assets/extensions" "$STAGE/public/assets/theme" "$STAGE/public/assets/theme.css"
for extension in "$ROOT"/extensions/gobia-*/; do
    name="$(basename "$extension")"
    if [ -d "$extension/dist" ]; then
        rm -rf "$STAGE/extensions/$name/dist"
        cp -r "$extension/dist" "$STAGE/extensions/$name/dist"
    fi
done
if [ -n "${RELEASE_VERSION:-}" ]; then
    php -r '$f=$argv[1]; $j=json_decode(file_get_contents($f), true); $j["gobia_version"]=$argv[2]; file_put_contents($f, json_encode($j, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n");' "$STAGE/gobia-release.json" "$VERSION"
fi
if [ -n "${RELEASE_EXTRA_DIR:-}" ]; then cp -r "$RELEASE_EXTRA_DIR"/. "$STAGE"/; fi

# Runtime dependencies only. Scripts are skipped because they need an application key; discovery runs below.
(cd "$STAGE" && composer install --no-dev --optimize-autoloader --no-interaction --no-progress --no-scripts ${COMPOSER_EXTRA_ARGS:-})
(cd "$STAGE" && mkdir -p bootstrap/cache storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs \
    && APP_KEY="base64:$(php -r 'echo base64_encode(random_bytes(32));')" APP_ENV=production APP_ENVIRONMENT_ONLY=true CACHE_DRIVER=array \
       QUEUE_CONNECTION=sync SESSION_DRIVER=array PTERODACTYL_EXTENSIONS_ENABLED=false php artisan package:discover --ansi \
    && rm -f bootstrap/cache/config.php bootstrap/cache/routes-*.php bootstrap/cache/events.php)

# Runtime state, development tooling and anything the updater refuses.
rm -rf "$STAGE/vendor/bin" "$STAGE/storage" "$STAGE/node_modules" "$STAGE/.git" "$STAGE/.github" "$STAGE/.env" "$STAGE/.env.ci" \
    "$STAGE/tests" "$STAGE/tools" "$STAGE/services/mock-wings" "$STAGE/scripts/gobia" "$STAGE/docker-compose.example.yml" "$STAGE/Dockerfile"
find "$STAGE/extensions" -maxdepth 2 \( -name node_modules -o -name .github \) -prune -exec rm -rf {} +
if [ -n "$(find "$STAGE" -type l)" ]; then
    echo "The package must not contain symbolic links:" >&2
    find "$STAGE" -type l >&2
    exit 1
fi
if find "$STAGE" -maxdepth 1 -name '.env*' ! -name '.env.example' | grep -q .; then
    echo "Environment files must not be packaged." >&2
    exit 1
fi

mkdir -p "$OUT/$VERSION"
PACKAGE="$OUT/$VERSION/gobia-panel-$VERSION.tar.gz"
tar -C "$STAGE" --sort=name --owner=0 --group=0 --numeric-owner --mode='u+rwX,go+rX,go-w' -czf "$PACKAGE" . 2>/dev/null \
    || tar -C "$STAGE" -czf "$PACKAGE" .

php "$ROOT/scripts/release/sign.php" "$PACKAGE" "$STAGE" "$OUT/$VERSION/release.json" | tee "$PACKAGE.sha256"
echo "Built $PACKAGE ($(du -h "$PACKAGE" | cut -f1))"
