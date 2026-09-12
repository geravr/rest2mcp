# Dockerfile for the React SPA (apps/app)
# Build: docker build --tag app:latest -f ./apps/app/Dockerfile .

# ===========================================================================
# Stage 1: Build the SPA
# ===========================================================================
FROM oven/bun:slim AS builder

WORKDIR /usr/src/app

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

RUN bun install --frozen-lockfile

# Copy source needed for the SPA build
COPY packages/ ./packages/
COPY db/ ./db/
COPY apps/app/ ./apps/app/
RUN bun --filter @repo/app build

# ===========================================================================
# Stage 2: Serve with nginx
# ===========================================================================
FROM nginx:alpine

COPY --from=builder /usr/src/app/apps/app/dist /usr/share/nginx/html
COPY apps/app/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
