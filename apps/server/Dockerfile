# otterdeploy: ONE image for both the control-plane `server` and the `builder`
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
# evlog's optional `nitro` peer, plus vite/vitest/esbuild/rolldown build tooling).
# None of which either runtime role imports. The prune deletes that dead store
# weight; the slim `runtime` stage then COPYs the trimmed /app across.

# Pinned (NOT the floating tag) so `bun install --frozen-lockfile` stays
# reproducible: keep at/above the bun that writes bun.lock locally.
ARG BUN_VERSION=1.4.2
# Railpack CLI: kept in lockstep with the RAILPACK_FRONTEND tag in
# apps/builder/src/railpack.ts (a CLI/frontend skew breaks builds).
ARG RAILPACK_VERSION=0.35.0
# rustic backup engine (Rust CLI), vendored into the runtime stage; the server's
# backup subsystem shells out to it. Pin + literal-hash so the layer is
# reproducible. Bump both together with the upstream release SHA256.
ARG RUSTIC_VERSION=0.11.3
# Turbo CLI (builder role): used ONLY for `turbo prune`, which runs on the host
# before the build container exists, so it can't come from the repo's own
# node_modules. Prune output is version-tolerant; this tracks the ecosystem
# rather than any one repo's pin.
ARG TURBO_VERSION=2.9.14
# Docker CLI + buildx plugin (builder role). Static binaries, pinned + SHA-verified
# like the tools above: Debian's own packages trail far behind (trixie ships buildx
# 0.13), and Docker's apt repo would add a keyring + second source for two files.
ARG DOCKER_VERSION=29.8.2
ARG BUILDX_VERSION=0.34.1

# ── build stage: full toolchain, discarded from the final image ───────────────
# Same libc as the runtime stage: the scoped production node_modules built here
# are copied across, and a native optional dep resolved for musl would not load
# on the glibc runtime.
FROM oven/bun:${BUN_VERSION}-slim AS build
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
# bootable (real optional peers like drizzle-orm survive, see the script header).
RUN bun run scripts/prune-bun-store.ts /app

# ── runtime stage: bun + docker CLI + buildx + railpack; serves BOTH roles ────
# Debian slim (glibc), NOT alpine: `railpack prepare` runs HERE (builder role +
# per-build helpers) and resolves every toolchain version through mise. Railpack
# always downloads the musl mise build, and mise filters what it can install to
# the libc it DETECTS at runtime: on alpine that meant musl-only, so a JDK with no
# musl build (Railpack's default java@21 = openjdk 21.0.2) resolved to nothing and
# every Java app without a pinned JDK failed with "Failed to resolve version 21 of
# java". Railpack scrubs the env of its mise calls, so MISE_LIBC
# cannot reach it. The image Railpack BUILDS in is glibc Debian; planning on the
# same libc means mise only picks what that build can install. The built app
# images are unaffected: they come from Railpack's own builder/runtime images.
FROM oven/bun:${BUN_VERSION}-slim AS runtime
ARG RAILPACK_VERSION
# curl: server healthcheck + the pinned railpack/rustic/docker downloads below.
# git: builder clones repos.
# openssh-client: ssh-keygen + the in-app PTY.
#
# bash: for a Python app, prepare resolves the version through mise's pyenv
# plugin, whose `python-build --definitions` is a `#!/usr/bin/env bash` script
#. Debian ships it; listed so the dependency is explicit. Pinned by
# apps/builder/src/__tests__/builder-image.test.ts.
RUN apt-get update -qq \
 && apt-get install -qq -y --no-install-recommends \
      bash ca-certificates curl git openssh-client tar \
 && rm -rf /var/lib/apt/lists/*
# docker CLI + buildx: the builder shells out to `docker buildx build` / `docker
# run` (helper containers); the server ignores them, driving docker over the
# socket via @otterdeploy/docker. Both are static binaries: only the `docker`
# client is taken from Docker's static bundle (no daemon), and buildx goes where
# the CLI looks for plugins.
ARG TARGETARCH
ARG DOCKER_VERSION
ARG BUILDX_VERSION
RUN case "${TARGETARCH}" in \
      amd64) DOCKER_ARCH=x86_64  DOCKER_SHA=995d1ef289677f74fd58d8d2c35727b6a4ee389c69db8638a3e42d0487aa5b0f \
             BUILDX_ARCH=amd64   BUILDX_SHA=f1332ddb9010bd0b72628266c3a906d9a6979848033df4c8d9bd2cd113bae12b ;; \
      arm64) DOCKER_ARCH=aarch64 DOCKER_SHA=76a624e4a8e5da654d1150e808175125efb5a6f1b6aa1cbd9caee18f51047a50 \
             BUILDX_ARCH=arm64   BUILDX_SHA=c34e32dd6ea2653d960d6c099c9f09b9077e4a37504d2d31e5066eccc3904231 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL --max-time 600 -o /tmp/docker.tgz \
      "https://download.docker.com/linux/static/stable/${DOCKER_ARCH}/docker-${DOCKER_VERSION}.tgz" \
 && echo "${DOCKER_SHA}  /tmp/docker.tgz" | sha256sum -c - \
 && tar -xzf /tmp/docker.tgz -C /tmp docker/docker \
 && install -m 0755 /tmp/docker/docker /usr/local/bin/docker \
 && curl -fsSL --max-time 600 -o /tmp/docker-buildx \
      "https://github.com/docker/buildx/releases/download/v${BUILDX_VERSION}/buildx-v${BUILDX_VERSION}.linux-${BUILDX_ARCH}" \
 && echo "${BUILDX_SHA}  /tmp/docker-buildx" | sha256sum -c - \
 && install -D -m 0755 /tmp/docker-buildx /usr/local/lib/docker/cli-plugins/docker-buildx \
 && rm -rf /tmp/docker.tgz /tmp/docker /tmp/docker-buildx \
 && docker --version \
 && /usr/local/lib/docker/cli-plugins/docker-buildx version
# Railpack CLI (builder role): `railpack prepare` emits a BuildKit plan that
# `docker buildx build` executes via the railpack-frontend image.
#
# Installed from the pinned tarball rather than `curl https://railpack.com/
# install.sh | sh`: fetching the asset directly also makes the
# layer reproducible and checksum-verified, the same way rustic is handled
# below. Upstream only publishes MUSL builds; they are static, so they run on
# this glibc base unchanged.
RUN case "${TARGETARCH}" in \
      amd64) RAILPACK_ARCH=x86_64 RAILPACK_SHA=d039785dd926ba059031c9c463c51f1462f344c844f828ac872c1f6d46fed7f1 ;; \
      arm64) RAILPACK_ARCH=arm64  RAILPACK_SHA=ad147486812f2d17c7fd2a6965c580e5e1fa4f7e51f5c9e458ad2c3a5f6a3f79 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL --max-time 600 -o /tmp/railpack.tar.gz \
      "https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/railpack-v${RAILPACK_VERSION}-${RAILPACK_ARCH}-unknown-linux-musl.tar.gz" \
 && echo "${RAILPACK_SHA}  /tmp/railpack.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/railpack.tar.gz -C /tmp railpack \
 && install -m 0755 /tmp/railpack /usr/local/bin/railpack \
 && rm -f /tmp/railpack.tar.gz /tmp/railpack \
 && railpack --version
# rustic backup engine: MUSL asset, SHA256-verified, per-arch. The `rustic`
# binary sits at the archive root; install it to /usr/local/bin (matches the
# runtime default RUSTIC_BIN). curl + ca-certificates come from the apt layer
# above. TARGETARCH is provided by BuildKit (the images workflow builds each
# arch natively), so we pick the matching rustic target + checksum, the old
# hardcoded x86_64 asset installed a non-executable binary on arm64 (exit 126).
ARG RUSTIC_VERSION
RUN case "${TARGETARCH}" in \
      amd64) RUSTIC_ARCH=x86_64  RUSTIC_SHA=3298555dc3da30d1cdf6775783e7c777ac4d148708721b3aecbe630ac827b3a9 ;; \
      arm64) RUSTIC_ARCH=aarch64 RUSTIC_SHA=6727624891521af77ea9ffde8204db3e3bddd3e0bf6db2767ff788cb206ae704 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL --max-time 600 -o /tmp/rustic.tar.gz \
      "https://github.com/rustic-rs/rustic/releases/download/v${RUSTIC_VERSION}/rustic-v${RUSTIC_VERSION}-${RUSTIC_ARCH}-unknown-linux-musl.tar.gz" \
 && echo "${RUSTIC_SHA}  /tmp/rustic.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/rustic.tar.gz -C /tmp rustic \
 && install -m 0755 /tmp/rustic /usr/local/bin/rustic \
 && rm -f /tmp/rustic.tar.gz /tmp/rustic \
 && rustic --version
# Turbo CLI (builder role): `turbo prune <app>` trims the clone to the packages
# a service actually reaches before railpack analyses it, so the install skips
# workspaces the app never imports (measured on this repo: 17 packages → 10,
# context 48.9 MB → 23 MB). Opt-in per service via buildConfig.turboPrune.
#
# Installed from the pinned npm platform package rather than the `turbo`
# wrapper: we want the bare binary, not a node_modules tree. Both published
# Linux builds are STATICALLY linked (verified: `static-pie`/`statically
# linked`), so they run on any libc with no compat shim.
# Same pinned + SHA-verified shape as railpack and rustic above.
ARG TURBO_VERSION
RUN case "${TARGETARCH}" in \
      amd64) TURBO_PKG=linux-64   TURBO_DIR=turbo-linux-x64   TURBO_SHA=b1973fcb98ab43a1cc4d24474bee832e9c0e7fdd86eedb9869517f5a4472eb48 ;; \
      arm64) TURBO_PKG=linux-arm64 TURBO_DIR=turbo-linux-arm64 TURBO_SHA=7cee908303bfd8ff3372b1cada7b4378a0476b9f59642014188ab62abdd99b39 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL --max-time 600 -o /tmp/turbo.tgz \
      "https://registry.npmjs.org/@turbo/${TURBO_PKG}/-/${TURBO_PKG}-${TURBO_VERSION}.tgz" \
 && echo "${TURBO_SHA}  /tmp/turbo.tgz" | sha256sum -c - \
 && tar -xzf /tmp/turbo.tgz -C /tmp "${TURBO_DIR}/bin/turbo" \
 && install -m 0755 "/tmp/${TURBO_DIR}/bin/turbo" /usr/local/bin/turbo \
 && rm -rf /tmp/turbo.tgz "/tmp/${TURBO_DIR}" \
 && turbo --version

WORKDIR /app
# Bring the built app + scoped production node_modules across from the build
# stage (preserves the module-resolution layout + carries the SPA + migrations).
COPY --from=build /app /app

ENV NODE_ENV=production
ENV PORT=3000
# The server bundles to apps/server/dist, so migrate.ts's `./migrations` sibling
# lookup doesn't resolve at runtime, point it at the copied-in folder.
ENV DB_MIGRATIONS_DIR=/app/packages/db/src/migrations
EXPOSE 3000

# WORKDIR is apps/builder so the builder worker (`bun run src/index.ts`) and the
# per-build helpers (`bun run src/build-one.ts <id>`) resolve their relative
# paths; the server role passes an absolute path to its bundle. Default = server.
WORKDIR /app/apps/builder
CMD ["bun", "run", "/app/apps/server/dist/index.mjs"]
