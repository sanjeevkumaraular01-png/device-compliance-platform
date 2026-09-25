# syntax=docker/dockerfile:1.7
# SecureEndpoint Manager — admin console (Next.js standalone)

ARG NODE_IMAGE=node:22-alpine

# ───────────── deps ─────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ───────────── build ─────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
# The /api rewrite target is resolved at build time and baked into the routes manifest.
ARG API_INTERNAL_URL=http://backend:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL} \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ───────────── runtime ─────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ARG API_INTERNAL_URL=http://backend:4000
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    API_INTERNAL_URL=${API_INTERNAL_URL}

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
