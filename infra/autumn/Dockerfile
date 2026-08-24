# ghcr.io/dr34mw0rk5/autumn — prebuilt image for the Autumn billing template.
#
# Autumn (github.com/useautumn/autumn, Apache-2.0) publishes no container
# image, so we build one from a pinned upstream commit and the template pulls
# it like every other catalog entry. One image serves every process in the
# stack with a different command (server / workers / cron / dashboard),
# mirroring how upstream deploys the same image per service.
#
# Published MANUALLY (no CI workflow): build for both arches, push per-arch
# tags, then merge the manifest, e.g.
#   docker buildx build --platform linux/amd64 -t ghcr.io/dr34mw0rk5/autumn:sha-<pin>-amd64 --push .
#   docker buildx build --platform linux/arm64 -t ghcr.io/dr34mw0rk5/autumn:sha-<pin>-arm64 --push .
#   docker buildx imagetools create -t ghcr.io/dr34mw0rk5/autumn:sha-<pin> \
#     -t ghcr.io/dr34mw0rk5/autumn:latest \
#     ghcr.io/dr34mw0rk5/autumn:sha-<pin>-amd64 ghcr.io/dr34mw0rk5/autumn:sha-<pin>-arm64
# To upgrade: bump AUTUMN_SHA below, rebuild, and point the template's
# AUTUMN_IMAGE tag (templates-billing.ts) at the new pin.
#
# The dashboard is prebuilt here with sentinel origins: VITE_* vars are
# compile-time, so the dist is baked against http://__AUTUMN_API_URL__ /
# http://__AUTUMN_CLIENT_URL__ and the dashboard service rewrites those to the
# deployment's real URLs at container start (see serve-dist.ts + the template's
# dashboard command). Building at container start instead OOM-killed on small
# hosts.
# ---------------------------------------------------------------- builder --
# Full workspace install (devDependencies included) purely so the dashboard
# can be built. None of this stage reaches the published image.
FROM oven/bun:1.3.14 AS builder

WORKDIR /app

# git for the pinned clone; ca-certificates because oven/bun ships an empty
# /etc/ssl/certs and native TLS needs the system bundle.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# Pinned commit of github.com/useautumn/autumn (dev branch). Upstream tags SDK
# releases only, so a commit pin is the only reproducible reference.
ARG AUTUMN_SHA=7ed106c32f90aa9ae06761e929bc4138d9e852c9
RUN git init -q . \
  && git remote add origin https://github.com/useautumn/autumn.git \
  && git fetch -q --depth 1 origin ${AUTUMN_SHA} \
  && git checkout -q FETCH_HEAD \
  && rm -rf .git

RUN bun install --ignore-scripts --frozen-lockfile

# Drizzle's migrator wraps each migration in a transaction, and upstream's
# migrations use CREATE INDEX CONCURRENTLY, which Postgres forbids inside one.
# CONCURRENTLY only matters on a live, loaded database — for a self-host
# provision the plain form is equivalent, so normalize it (build-time, so the
# migrator's content hashes stay stable across container restarts).
RUN sed -i 's/CREATE INDEX CONCURRENTLY/CREATE INDEX/g; s/CREATE UNIQUE INDEX CONCURRENTLY/CREATE UNIQUE INDEX/g; s/DROP INDEX CONCURRENTLY/DROP INDEX/g' /app/shared/drizzle/*.sql

# Migration entrypoint the stack's server service runs before `bun start`.
# Upstream's `db:migrate` shells drizzle-kit through a node loader that dies
# silently under bun, and upstream's schema assumes Supabase's preinstalled
# pg_trgm — vanilla Postgres needs it created first. Lives in /app/server, whose
# node_modules links drizzle-orm and pg under bun's isolated installs.
COPY <<'EOF' /app/server/autumn-migrate.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
await client.end();

const db = drizzle(process.env.DATABASE_URL!);
await migrate(db, { migrationsFolder: "/app/shared/drizzle" });
console.log("migrations applied");
process.exit(0);
EOF

# Prebuild the dashboard against sentinel origins (rewritten at container
# start). tsc is upstream's own build step; the vite build is why this image
# build wants a few GB of RAM — done once here so runtime hosts never pay it.
# --max-old-space-size: rollup on this bundle exceeds node's default 4GB heap.
RUN cd /app/vite \
  && NODE_OPTIONS=--max-old-space-size=8192 \
     VITE_BACKEND_URL=http://__AUTUMN_API_URL__ \
     VITE_FRONTEND_URL=http://__AUTUMN_CLIENT_URL__ \
     bun run build

# ---------------------------------------------------------------- runtime --
# Only the server's dependency closure, production-only. The builder's 4.9 GB
# node_modules never lands here; see the pruning notes on the install below.
FROM oven/bun:1.3.14 AS runtime

WORKDIR /app

# No git in the runtime image: the source arrives via COPY --from=builder.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Source only. apps/ and vite/package.json are copied solely so bun can resolve
# every workspace member named in bun.lock under --frozen-lockfile.
COPY --from=builder /app/package.json /app/bun.lock /app/turbo.json /app/
COPY --from=builder /app/server   /app/server
COPY --from=builder /app/shared   /app/shared
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/scripts  /app/scripts
COPY --from=builder /app/apps     /app/apps
COPY --from=builder /app/vite/package.json /app/vite/package.json
RUN find /app -maxdepth 3 -name node_modules -type d -exec rm -rf {} + 2>/dev/null; true

# The size fix. Three separate problems, three separate remedies:
#
#   --production      upstream's devDependencies include artillery, playwright-core,
#                     mocha, react-email and three TypeScript versions.
#   --filter          a bare `bun install` resolves all ~23 workspaces. This image
#                     runs the server and serves a prebuilt dashboard, so only the
#                     server's workspace closure is needed. Filtering out apps/leaf,
#                     apps/website, apps/docs and packages/{mcp,ui,render,openapi}
#                     drops @mastra, monaco-editor, mermaid and node-sql-parser.
#   rm next@*         autumn-js declares next as an OPTIONAL peerDependency, and bun
#                     installs optional peers regardless. The server only imports
#                     autumn-js's backend handler, never the next/react adapters, so
#                     two Next.js copies plus four @next/swc native binaries (829 MB)
#                     are dead weight. `--omit=peer` is NOT a valid substitute — it
#                     also removes zod, which @autumn/shared resolves through a peer.
#   rm *-musl@*       the base image is Debian (glibc); musl-targeted native builds
#                     of duckdb et al. can never load.
RUN bun install --ignore-scripts --frozen-lockfile --production \
      --filter "./server" --filter "./shared" \
      --filter "./packages/auth" --filter "./packages/env" \
      --filter "./packages/ksuid" --filter "./packages/stripe-sync" \
      --filter "./packages/autumn-js" --filter "./packages/sdk" \
  && rm -rf /app/node_modules/.bun/next@* /app/node_modules/.bun/@next+swc-* \
  && rm -rf /app/node_modules/.bun/*-musl@* \
  && rm -rf /root/.bun/install/cache

COPY --from=builder /app/vite/dist /app/vite/dist

# Static server for the dashboard dist. Bun-native, no extra dependency
# (upstream's `start` script wants a globally-installed `serve`, and vite
# preview rejects unknown Host headers). SPA fallback to index.html.
COPY <<'EOF' /app/vite/serve-dist.ts
const root = process.argv[2] ?? "/app/vite/dist";
Bun.serve({
  port: 3000,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    let file = Bun.file(root + path);
    if (!(await file.exists())) file = Bun.file(root + "/index.html");
    return new Response(file);
  },
});
console.log(`dashboard serving ${root} on :3000`);
EOF

ENV NODE_ENV=production

# Last (metadata-only) so editing them never invalidates the heavy layers.
# The source label links the GHCR package to the repo.
LABEL org.opencontainers.image.source="https://github.com/otterdeploy/otterdeploy" \
  org.opencontainers.image.description="Autumn (useautumn/autumn) built from a pinned commit for the otterdeploy stack template" \
  org.opencontainers.image.licenses="Apache-2.0"

EXPOSE 8080

WORKDIR /app/server
CMD ["bun", "start"]
