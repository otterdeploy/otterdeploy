# apps/server — the otterdeploy control plane: the Hono/oRPC API + the built web
# dashboard served from the SAME origin as one published image. bun runs the
# tsdown-bundled server directly; the SPA is built with vite and staged at
# ./public, which src/index.ts serves after all API routes (SPA fallback to
# index.html). Wired into docker-compose.prod.yml as the `server` service.
#
# MULTI-STAGE: a full-toolchain `build` stage installs every workspace
# dependency and produces the server bundle + the SPA; the slim `runtime` stage
# ships only the bundle, the SPA, the migrations, and PRODUCTION node_modules —
# dropping the ~1.3GB of dev dependencies (tsdown / vite / turbo / drizzle-kit /
# typescript / eslint …) the old single-stage image carried. That roughly halves
# the image, which also halves pull time and the disk a few `install.sh update`s
# consume (stale multi-GB layers were filling small disks → Postgres ENOSPC).
#
# The runtime still needs the docker CLI + buildx/compose plugins (the runtime()
# driver shells out for some paths), curl (the compose healthcheck GET /health),
# git, and openssh-client (ssh-keygen + the in-app PTY). It drives the HOST
# docker daemon over the mounted /var/run/docker.sock via the @otterdeploy/docker
# socket client.

# Pinned (NOT the floating tag) so `bun install --frozen-lockfile` stays
# reproducible — keep at/above the bun that writes bun.lock locally. Matches the
# builder image's pin.
ARG BUN_VERSION=1.3.14

# ── build stage: full toolchain, discarded from the final image ───────────────
FROM oven/bun:${BUN_VERSION}-debian AS build
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

# Drop dev dependencies now the build is done: wipe every node_modules tree and
# reinstall production-only. tsdown's `noExternal: [@otterdeploy/*]` bundled the
# workspace code into dist, so the runtime only needs the externalized
# THIRD-PARTY prod deps — which a production install provides at the same
# resolution paths, minus tsdown/vite/turbo/drizzle-kit/typescript/eslint/etc.
RUN find . -type d -name node_modules -prune -exec rm -rf {} + \
 && bun install --production

# ── runtime stage: slim, only what boot needs ─────────────────────────────────
FROM oven/bun:${BUN_VERSION}-debian AS runtime
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
# Bring the built app + production-only node_modules across from the build stage.
# Copying the whole (dev-pruned) /app tree preserves the exact module-resolution
# layout the bundle expects, and carries the SPA (public/) + migrations.
COPY --from=build /app /app

ENV NODE_ENV=production
ENV PORT=3000
# The server bundles to apps/server/dist, so migrate.ts's `./migrations` sibling
# lookup (import.meta.url) doesn't resolve at runtime — point it at the copied-in
# folder. runMigrations() runs on boot (apps/server/src/index.ts).
ENV DB_MIGRATIONS_DIR=/app/packages/db/src/migrations
EXPOSE 3000

WORKDIR /app/apps/server
CMD ["bun", "run", "dist/index.mjs"]
