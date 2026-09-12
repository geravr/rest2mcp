#!/usr/bin/env sh
set -eu

if [ "${AUTO_MIGRATE:-true}" = "true" ]; then
  echo "[entrypoint] Running production database migrations..."
  bun --cwd /usr/src/app/db migrate
  echo "[entrypoint] Migrations complete."
else
  echo "[entrypoint] Skipping migrations (AUTO_MIGRATE=${AUTO_MIGRATE:-false})."
fi

exec "$@"
