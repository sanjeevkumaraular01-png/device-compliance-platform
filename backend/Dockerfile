# syntax=docker/dockerfile:1.7
# SecureEndpoint Manager backend (NestJS API + BullMQ workers)

ARG NODE_IMAGE=node:22-alpine

# ── base ───────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
# openssl: required by Prisma engines; libc6-compat: prebuilt native modules
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app

# ── deps (all dependencies, incl. dev for the build) ───────────────────
FROM base AS deps
# toolchain only needed if a native module (argon2) has no musl prebuild
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── build ──────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.json tsconfig.build.json tsconfig.seed.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && npx prisma generate

# ── runtime ────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    APP_ROLE=all \
    REPORTS_DIR=/data/reports \
    CA_CERT_PATH=/data/pki/ca.crt \
    CA_KEY_PATH=/data/pki/ca.key
RUN apk add --no-cache tini wget
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json prisma.config.ts docker-entrypoint.sh ./
RUN sed -i 's/\r$//' docker-entrypoint.sh \
 && chmod 0755 docker-entrypoint.sh \
 && mkdir -p /data/reports /data/pki \
 && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
