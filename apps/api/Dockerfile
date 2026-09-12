# Dockerfile for the tRPC API Server (multi-stage)
# Build: docker build --tag api:latest -f ./apps/api/Dockerfile .
# Run:   docker run --env-file .env -p 8080:8080 api:latest

# ===========================================================================
# Stage 1: Install dependencies and build
# ===========================================================================
FROM oven/bun:slim AS builder

WORKDIR /usr/src/app

# Copy lockfile and root package.json first for layer caching
COPY bun.lock package.json tsconfig.json ./

# Copy ALL workspace package.json files (needed for bun install resolution)
COPY apps/api/package.json ./apps/api/package.json
COPY apps/app/package.json ./apps/app/package.json
COPY apps/email/package.json ./apps/email/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json
COPY db/package.json ./db/package.json
COPY scripts/package.json ./scripts/package.json

# Install all deps (workspace resolution needs the full monorepo structure)
RUN bun install --frozen-lockfile

# Copy source needed for the API build
COPY packages/ ./packages/
COPY db/ ./db/
COPY apps/email/ ./apps/email/
COPY apps/api/ ./apps/api/

# Build email templates (required before API build)
RUN bun --filter @repo/email build

# Build the API — bundles everything into dist/index.js
# Use serve.ts as entrypoint (standalone Bun server)
RUN cd apps/api && bun build serve.ts --outdir dist --target bun

# ===========================================================================
# Stage 2: Production runtime
# ===========================================================================
FROM oven/bun:slim

RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && \
    rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Copy bundled server output
COPY --from=builder --chown=bun:bun /usr/src/app/apps/api/dist ./dist
# Copy DB workspace + deps so startup migrations can run in production
COPY --from=builder --chown=bun:bun /usr/src/app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /usr/src/app/db ./db
COPY --from=builder --chown=bun:bun /usr/src/app/package.json ./package.json
COPY --from=builder --chown=bun:bun /usr/src/app/bun.lock ./bun.lock
COPY --from=builder --chown=bun:bun /usr/src/app/apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN test -f ./dist/serve.js || (echo "Error: dist/serve.js not found" && exit 1)
RUN test -f /usr/local/bin/docker-entrypoint.sh || (echo "Error: entrypoint not found" && exit 1)

USER bun
EXPOSE 8080

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "dist/serve.js"]
