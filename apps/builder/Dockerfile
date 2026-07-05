# apps/builder — long-running BullMQ worker that turns git pushes into
# container images. Railpack is the only builder, so the base is the bun
# runtime image; we add the docker CLI + buildx and the railpack CLI on top.
#
# The container needs the host's docker socket mounted at /var/run/docker.sock
# at runtime — `docker buildx build` (railpack) and the optional `docker push`
# both speak to it. Railpack runs a two-step flow: `railpack prepare` emits a
# BuildKit plan, then `docker buildx build` executes it through the
# railpack-frontend image (pulled on demand). On the default local-build path
# the resulting image is `--load`ed into the host daemon and never pushed.
#
# Wired into docker-compose.yml as the `builder` service. It mounts the host
# docker socket (Docker-out-of-Docker) so `buildx --load` lands images in the
# SAME daemon the single-node swarm runs from — DinD would build into an
# isolated daemon the swarm can't see. bun runs the worker's TypeScript
# directly, so there's no separate compile step; `bun install` resolves the
# whole workspace for the image's architecture (see .dockerignore).

# Pinned (NOT the floating `1-debian`) so `bun install --frozen-lockfile`
# stays reproducible. The floating tag regressed to bun 1.3.1, which fails
# this lockfile with a bare "Failed to install N packages" (exit 1) — newer
# bun installs the identical lockfile cleanly. Keep this at/above the bun
# version that writes bun.lock locally to avoid old-bun-on-new-lockfile skew.
ARG BUN_VERSION=1.3.14
FROM oven/bun:${BUN_VERSION}-debian

# Docker CLI + buildx (no daemon — we use the host's via the mounted socket).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && chmod a+r /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin \
 && rm -rf /var/lib/apt/lists/*

# Railpack CLI — `railpack prepare` analyses the repo and emits a BuildKit
# plan that `docker buildx build` then executes via the railpack-frontend.
# `--yes` skips the installer's interactive confirmation (there's no TTY in
# an image build, so the default prompt would abort); `--bin-dir` pins the
# binary onto $PATH. The `railpack --version` line fails the build loudly if
# the install didn't land, instead of surfacing later as a runtime
# "Executable not found in $PATH" on the first deploy.
#
# Pinned (NOT `latest`, via RAILPACK_VERSION) so the CLI that emits the plan
# stays in lockstep with the railpack-frontend image that executes it — the
# RAILPACK_FRONTEND tag in src/railpack.ts MUST match this. A CLI/frontend skew
# surfaces as cryptic BuildKit errors like "secret RAILPACK_SPA_OUTPUT_DIR: not
# found"; `latest` on both pointers drifts independently and breaks builds.
ARG RAILPACK_VERSION=0.26.1
RUN RAILPACK_VERSION="${RAILPACK_VERSION}" sh -c \
    'curl -sSL https://railpack.com/install.sh | sh -s -- --yes --bin-dir /usr/local/bin' \
 && railpack --version

WORKDIR /app
COPY . .
# Install, then prune to production — in ONE layer. A separate later `rm` can't
# reclaim the fat all-deps layer (Docker layers are additive: deleted files still
# cost their original layer's size), so the whole install→prune must happen in a
# single RUN so only the pruned node_modules is committed. --frozen-lockfile
# validates the lockfile first; the worker runs the TS source via bun (no
# build/bundle step), so it needs prod deps + the workspace source but not
# tsdown/vite/turbo/drizzle-kit/typescript (bun transpiles TS at runtime).
RUN bun install --frozen-lockfile \
 && find . -type d -name node_modules -prune -exec rm -rf {} + \
 && bun install --production

WORKDIR /app/apps/builder
CMD ["bun", "run", "src/index.ts"]
