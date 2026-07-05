# apps/server — the otterdeploy control plane: the Hono/oRPC API + the built web
# dashboard served from the SAME origin as one published image. bun runs the
# tsdown-bundled server directly; the SPA is built with vite and staged at
# ./public, which src/index.ts serves after all API routes (SPA fallback to
# index.html). Wired into docker-compose.prod.yml as the `server` service.
#
# It drives the HOST docker daemon over the mounted /var/run/docker.sock via the
# @otterdeploy/docker socket client (provisioning needs no docker CLI); the CLI
# + buildx/compose plugins are still installed as a safety net for runtime paths
# that shell out. curl is REQUIRED by the compose healthcheck (GET /health);
# openssh-client backs the SSH-key generator (`ssh-keygen`) and the base image's
# shell backs the in-app terminal (PTY).

# Pinned (NOT the floating tag) so `bun install --frozen-lockfile` stays
# reproducible — keep at/above the bun that writes bun.lock locally. Matches the
# builder image's pin.
ARG BUN_VERSION=1.3.14
FROM oven/bun:${BUN_VERSION}-debian

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg openssh-client \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && chmod a+r /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# COPY the whole repo so both the web (vite) and server (tsdown) builds resolve
# every workspace package; .dockerignore keeps node_modules + build output out.
COPY . .
RUN bun install --frozen-lockfile

# Build the SPA (vite → apps/web/dist) and the server bundle (tsdown →
# apps/server/dist), then stage the SPA where the server serves it (./public).
RUN bunx turbo build --filter=web --filter=server \
 && mkdir -p apps/server/public \
 && cp -r apps/web/dist/. apps/server/public/

ENV NODE_ENV=production
ENV PORT=3000
# The server bundles to apps/server/dist, so migrate.ts's `./migrations` sibling
# lookup (import.meta.url) doesn't resolve at runtime — point it at the migrations
# copied in with the repo. runMigrations() runs on boot (apps/server/src/index.ts).
ENV DB_MIGRATIONS_DIR=/app/packages/db/src/migrations
EXPOSE 3000

WORKDIR /app/apps/server
CMD ["bun", "run", "dist/index.mjs"]
