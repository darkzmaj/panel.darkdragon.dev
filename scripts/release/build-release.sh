#!/usr/bin/env bash
# Builds the deployable release package for the version in VERSION.
#
#   scripts/release/build-release.sh [output-dir]
#
# Prerequisites: the production frontend is already built (public/assets), composer and php are on PATH, and
# GOBIA_RELEASE_SIGNING_KEY (or GOBIA_RELEASE_SIGNING_KEY_FILE) holds the Ed25519 signing key.
# Optional: COMPOSER_EXTRA_ARGS (for example --ignore-platform-req=ext-posix on Windows),
#           RELEASE_VERSION overrides VERSION inside the package (local update testing only),
#           RELEASE_MIGRATIONS=true|false|auto, RELEASE_EXTRA_DIR=<dir> copied over the package (local testing only).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/dist}"
VERSION="${RELEASE_VERSION:-$(tr -d '[:space:]' < "$ROOT/VERSION")}"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-gobia\.[0-9]+$ ]]; then
    echo "Invalid version: $VERSION" >&2
    exit 1
fi
if [ ! -f "$ROOT/public/assets/manifest.json" ]; then
    echo "public/assets is missing; run 'yarn build:production' first." >&2
    exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Tracked files only (honours export-ignore in .gitattributes), so no local state can leak in.
git -C "$ROOT" archive HEAD | tar -x -C "$STAGE"
cp -r "$ROOT/public/assets" "$STAGE/public/"
printf '%s\n' "$VERSION" > "$STAGE/VERSION"
if [ -n "${RELEASE_EXTRA_DIR:-}" ]; then cp -r "$RELEASE_EXTRA_DIR"/. "$STAGE"/; fi

# Runtime dependencies only. Scripts are skipped because they need an application key; discovery runs below.
(cd "$STAGE" && composer install --no-dev --optimize-autoloader --classmap-authoritative --no-interaction --no-progress --no-scripts ${COMPOSER_EXTRA_ARGS:-})
(cd "$STAGE" && APP_KEY="base64:$(php -r 'echo base64_encode(random_bytes(32));')" APP_ENV=production CACHE_DRIVER=file QUEUE_CONNECTION=sync SESSION_DRIVER=file DB_CONNECTION=mysql php artisan package:discover --ansi)

# Runtime state and anything that must never be shipped or that the updater refuses.
rm -rf "$STAGE/vendor/bin" "$STAGE/storage" "$STAGE/node_modules" "$STAGE/.git" "$STAGE/.env" "$STAGE/.env.ci"
if [ -n "$(find "$STAGE" -type l)" ]; then
    echo "The package must not contain symbolic links:" >&2
    find "$STAGE" -type l >&2
    exit 1
fi
if find "$STAGE" -maxdepth 1 -name '.env*' ! -name '.env.example' | grep -q .; then
    echo "Environment files must not be packaged." >&2
    exit 1
fi

if [ "${RELEASE_MIGRATIONS:-auto}" = "auto" ]; then
    PREVIOUS="$(git -C "$ROOT" describe --tags --abbrev=0 --match 'v*-gobia.*' HEAD^ 2>/dev/null || true)"
    if [ -z "$PREVIOUS" ] || ! git -C "$ROOT" diff --quiet "$PREVIOUS" HEAD -- database/migrations database/schema; then
        MIGRATIONS=true
    else
        MIGRATIONS=false
    fi
else
    MIGRATIONS="$RELEASE_MIGRATIONS"
fi

mkdir -p "$OUT/$VERSION"
PACKAGE="$OUT/$VERSION/panel-$VERSION.tar.gz"
tar -C "$STAGE" --sort=name --owner=0 --group=0 --numeric-owner --mode='u+rwX,go+rX,go-w' -czf "$PACKAGE" . 2>/dev/null \
    || tar -C "$STAGE" -czf "$PACKAGE" .

php "$ROOT/scripts/release/sign.php" "$PACKAGE" "$VERSION" "$MIGRATIONS" true "$OUT/$VERSION/release.json" | tee "$PACKAGE.sha256"
echo "Built $PACKAGE ($(du -h "$PACKAGE" | cut -f1)), migrations=$MIGRATIONS"
