# otterdeploy — ONE image for both the control-plane `server` and the `builder`
# worker. They're the same monorepo on the same bun base; the builder is just the
# server's runtime PLUS the docker CLI + buildx + railpack it shells out to. So we
# ship a single image and pick the role by command (docker-compose.prod.yml):
#   server  → bun run /app/apps/server/dist/index.mjs   (Hono/oRPC API + dashboard)
#   builder → bun run src/index.ts                       (BullMQ build worker)
# The builder also spawns throwaway copies of THIS image as per-build helpers
# (`bun run src/build-one.ts <id>`), which is why WORKDIR is apps/builder.
#
# MULTI-STAGE: a full-toolchain `build` stage installs every workspace dep and
# produces the tsdown server bundle + the vite SPA; the slim `runtime` stage
# reinstalls deps SCOPED to just the server + builder workspaces
# (`bun install --filter server --filter builder --production`), so it never
# carries apps/web's frontend libraries (lucide-react, @hugeicons, date-fns,
# @cloudflare/workerd, vite, vitest, …) — those only exist to BUILD the SPA,
# which ships pre-built as static files under ./public.

# Pinned (NOT the floating tag) so `bun install --frozen-lockfile` stays
# reproducible — keep at/above the bun that writes bun.lock locally.
ARG BUN_VERSION=1.3.14
# Railpack CLI — kept in lockstep with the RAILPACK_FRONTEND tag in
# apps/builder/src/railpack.ts (a CLI/frontend skew breaks builds).
ARG RAILPACK_VERSION=0.26.1

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
# Reinstall SCOPED + production-only, in one layer, so only what the two runtime
# roles need is kept. --filter pulls just the server/builder workspaces and their
# (workspace + third-party) prod deps; apps/web/www/web-demo/native/cli and their
# frontend/build-only deps are excluded. tsdown already inlined @otterdeploy/*
# into the server bundle; the builder runs its TS source directly via bun.
RUN find . -type d -name node_modules -prune -exec rm -rf {} + \
 && bun install --filter server --filter builder --production

# ── runtime stage: bun + docker CLI + buildx + railpack; serves BOTH roles ────
FROM oven/bun:${BUN_VERSION}-debian AS runtime
ARG RAILPACK_VERSION
# curl: server healthcheck + railpack installer. git: builder clones repos.
# openssh-client: ssh-keygen + the in-app PTY. docker CLI + buildx: the builder
# shells out to `docker buildx build` / `docker run` (helper containers) — the
# server ignores them, driving docker over the socket via @otterdeploy/docker.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg openssh-client \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && chmod a+r /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin \
 && rm -rf /var/lib/apt/lists/*
# Railpack CLI (builder role) — `railpack prepare` emits a BuildKit plan that
# `docker buildx build` executes via the railpack-frontend image.
RUN RAILPACK_VERSION="${RAILPACK_VERSION}" sh -c \
    'curl -sSL https://railpack.com/install.sh | sh -s -- --yes --bin-dir /usr/local/bin' \
 && railpack --version

WORKDIR /app
# Bring the built app + scoped production node_modules across from the build
# stage (preserves the module-resolution layout + carries the SPA + migrations).
COPY --from=build /app /app

ENV NODE_ENV=production
ENV PORT=3000
# The server bundles to apps/server/dist, so migrate.ts's `./migrations` sibling
# lookup doesn't resolve at runtime — point it at the copied-in folder.
ENV DB_MIGRATIONS_DIR=/app/packages/db/src/migrations
EXPOSE 3000

# WORKDIR is apps/builder so the builder worker (`bun run src/index.ts`) and the
# per-build helpers (`bun run src/build-one.ts <id>`) resolve their relative
# paths; the server role passes an absolute path to its bundle. Default = server.
WORKDIR /app/apps/builder
CMD ["bun", "run", "/app/apps/server/dist/index.mjs"]
