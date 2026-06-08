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
# This is a placeholder Dockerfile — the monorepo build (bun install +
# turbo build) is left to whichever process image-builds this. Wire it
# into infra/docker-compose.yml when the deploy story is ready.

FROM oven/bun:1-debian

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
RUN curl -sSL https://railpack.com/install.sh | sh -s -- --yes --bin-dir /usr/local/bin \
 && railpack --version

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

WORKDIR /app/apps/builder
CMD ["bun", "run", "src/index.ts"]
