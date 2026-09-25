#!/bin/sh
# SecureEndpoint Manager backend entrypoint
#   RUN_MIGRATIONS=true -> prisma migrate deploy
#   RUN_SEED=true       -> idempotent seed (compiled JS)
#   then exec the Nest app (APP_ROLE=api|worker|all)
set -e

cd /app

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying database migrations"
  ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
fi

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "[entrypoint] running seed"
  node dist/prisma/seed.js
fi

echo "[entrypoint] starting backend (APP_ROLE=${APP_ROLE:-all})"
exec node dist/main.js "$@"
