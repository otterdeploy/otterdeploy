# apps/builder — long-running BullMQ worker that turns git pushes into
# pushed container images. Layered on the official nixpacks image so
# nixpacks itself stays at upstream's blessed version; we bolt on the
# bun runtime + docker CLI on top.
#
# The container needs the host's docker socket mounted at /var/run/docker.sock
# at runtime — `nixpacks build` and `docker push` both speak to it.
#
# This is a placeholder Dockerfile — the monorepo build (bun install +
# turbo build) is left to whichever process image-builds this. Wire it
# into infra/docker-compose.yml when the deploy story is ready.

FROM railwayapp/nixpacks:latest

# Docker CLI (no daemon — we use the host's via the mounted socket).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && chmod a+r /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli \
 && rm -rf /var/lib/apt/lists/*

# Bun runtime.
RUN curl -fsSL https://bun.sh/install | bash \
 && ln -s /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

WORKDIR /app/apps/builder
CMD ["bun", "run", "src/index.ts"]
