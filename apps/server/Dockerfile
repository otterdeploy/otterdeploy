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
# produces the tsdown server bundle + the vite SPA; then it reinstalls deps SCOPED
# to just the server + builder workspaces
# (`bun install --filter server --filter builder --production`) and GC's bun's
# content store (scripts/prune-bun-store.ts). The scoped install fixes the SYMLINK
# tree, but bun still extracts every dev-only + optional-peer package in the
# lockfile graph into node_modules/.bun (~560MB: workerd/wrangler/miniflare via
# evlog's optional `nitro` peer, plus vite/vitest/esbuild/rolldown build tooling)
# — none of which either runtime role imports. The prune deletes that dead store
# weight; the slim `runtime` stage then COPYs the trimmed /app across.

# Pinned (NOT the floating tag) so `bun install --frozen-lockfile` stays
# reproducible — keep at/above the bun that writes bun.lock locally.
ARG BUN_VERSION=1.3.14
# Railpack CLI — kept in lockstep with the RAILPACK_FRONTEND tag in
# apps/builder/src/railpack.ts (a CLI/frontend skew breaks builds).
ARG RAILPACK_VERSION=0.35.0
# rustic backup engine (Rust CLI) — vendored into the runtime stage; the server's
# backup subsystem shells out to it. Pin + literal-hash so the layer is
# reproducible. Bump both together with the upstream release SHA256.
ARG RUSTIC_VERSION=0.11.3

# ── build stage: full toolchain, discarded from the final image ───────────────
FROM oven/bun:${BUN_VERSION}-alpine AS build
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
# GC bun's content store down to what the two roles actually load: bun re-extracts
# every dev-only + optional-peer package into node_modules/.bun even under
# --production (evlog's optional nitro→wrangler→workerd peer chain, vite/vitest/
# esbuild/rolldown build tooling). Reclaims ~500MB; validated to keep both roles
# bootable (real optional peers like drizzle-orm survive — see the script header).
RUN bun run scripts/prune-bun-store.ts /app

# ── runtime stage: bun + docker CLI + buildx + railpack; serves BOTH roles ────
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
ARG RAILPACK_VERSION
# curl: server healthcheck + the pinned railpack/rustic downloads below.
# git: builder clones repos.
# openssh-client: ssh-keygen + the in-app PTY. docker CLI + buildx: the builder
# shells out to `docker buildx build` / `docker run` (helper containers) — the
# server ignores them, driving docker over the socket via @otterdeploy/docker.
#
# Alpine carries the docker CLI and the buildx plugin in its community repo, so
# this replaces the debian path's keyring + sources.list + second apt-get update
# with one apk call and no network round-trip to Docker's own repo.
RUN apk add --no-cache \
      ca-certificates curl git openssh-client tar \
      docker-cli docker-cli-buildx
# Railpack CLI (builder role) — `railpack prepare` emits a BuildKit plan that
# `docker buildx build` executes via the railpack-frontend image.
#
# Installed from the pinned tarball rather than `curl https://railpack.com/
# install.sh | sh`: that installer is `#!/usr/bin/env bash`, and alpine ships
# busybox ash with no bash at all. Fetching the asset directly also makes the
# layer reproducible and checksum-verified, the same way rustic is handled
# below — upstream only publishes MUSL builds, so alpine is its native target.
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
      amd64) RAILPACK_ARCH=x86_64 RAILPACK_SHA=d039785dd926ba059031c9c463c51f1462f344c844f828ac872c1f6d46fed7f1 ;; \
      arm64) RAILPACK_ARCH=arm64  RAILPACK_SHA=ad147486812f2d17c7fd2a6965c580e5e1fa4f7e51f5c9e458ad2c3a5f6a3f79 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/railpack.tar.gz \
      "https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/railpack-v${RAILPACK_VERSION}-${RAILPACK_ARCH}-unknown-linux-musl.tar.gz" \
 && echo "${RAILPACK_SHA}  /tmp/railpack.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/railpack.tar.gz -C /tmp railpack \
 && install -m 0755 /tmp/railpack /usr/local/bin/railpack \
 && rm -f /tmp/railpack.tar.gz /tmp/railpack \
 && railpack --version
# rustic backup engine — MUSL asset, SHA256-verified, per-arch. The `rustic`
# binary sits at the archive root; install it to /usr/local/bin (matches the
# runtime default RUSTIC_BIN). curl + ca-certificates come from the apk layer
# above. TARGETARCH is provided by BuildKit (the images workflow builds each
# arch natively), so we pick the matching rustic target + checksum — the old
# hardcoded x86_64 asset installed a non-executable binary on arm64 (exit 126).
ARG RUSTIC_VERSION
RUN case "${TARGETARCH}" in \
      amd64) RUSTIC_ARCH=x86_64  RUSTIC_SHA=3298555dc3da30d1cdf6775783e7c777ac4d148708721b3aecbe630ac827b3a9 ;; \
      arm64) RUSTIC_ARCH=aarch64 RUSTIC_SHA=6727624891521af77ea9ffde8204db3e3bddd3e0bf6db2767ff788cb206ae704 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/rustic.tar.gz \
      "https://github.com/rustic-rs/rustic/releases/download/v${RUSTIC_VERSION}/rustic-v${RUSTIC_VERSION}-${RUSTIC_ARCH}-unknown-linux-musl.tar.gz" \
 && echo "${RUSTIC_SHA}  /tmp/rustic.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/rustic.tar.gz -C /tmp rustic \
 && install -m 0755 /tmp/rustic /usr/local/bin/rustic \
 && rm -f /tmp/rustic.tar.gz /tmp/rustic \
 && rustic --version

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
