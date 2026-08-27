#!/bin/sh
set -eu

fail() {
  printf '%s\n' "[worker-entrypoint] failed: $*" >&2
  exit 1
}

DATA_ROOT="${DAMM_DATA_ROOT:-/var/data}"
[ "$DATA_ROOT" = "/var/data" ] || fail "DAMM_DATA_ROOT must be /var/data"
[ -d "$DATA_ROOT" ] || fail "/var/data does not exist"
[ ! -L "$DATA_ROOT" ] || fail "/var/data must not be a symlink"

# A directory baked into the image is ephemeral. Refuse to start unless Render (or a
# deliberate local docker volume) mounted the checkpoint disk at the contract path.
mountpoint -q "$DATA_ROOT" || fail "/var/data is not a mounted persistent disk"

if [ "$(id -u)" = "0" ]; then
  [ ! -L "$DATA_ROOT/checkouts" ] || fail "/var/data/checkouts must not be a symlink"
  install -d -m 0700 -o darworker -g darworker "$DATA_ROOT/checkouts"
  chown darworker:darworker "$DATA_ROOT"
  chmod 0700 "$DATA_ROOT"
  exec gosu darworker /bin/sh "$0" --worker-user
fi

[ "${1:-}" = "--worker-user" ] || fail "entrypoint must initialize the disk as root"
[ "$(id -u)" = "10001" ] || fail "worker must run as the unprivileged darworker user"
[ -w "$DATA_ROOT/checkouts" ] || fail "/var/data/checkouts is not writable"

PIPELINE_DIR="$(node /opt/app/deploy/worker/prepare-checkout.mjs)" \
  || fail "the pinned DAMM checkout could not be prepared"
[ -n "$PIPELINE_DIR" ] || fail "checkout preparation returned an empty path"

export DAMM_PIPELINE_DIR="$PIPELINE_DIR"
export DAMM_PIPELINE_PYTHON="/opt/damm-venv/bin/python"
export PYTHONDONTWRITEBYTECODE=1

node --experimental-strip-types /opt/app/deploy/worker/preflight.mjs \
  || fail "deployment preflight refused to start the worker"

cd /opt/app
exec node --experimental-strip-types --env-file-if-exists=/opt/app/.env scripts/worker.ts
