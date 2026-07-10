# otterdeploy

A self-hostable deployment platform. Deploy git-sourced services, databases, and compose stacks on your own servers — with the ease of a managed PaaS and none of the lock-in.

otterdeploy is the own-your-infra answer to Vercel and Railway, in the lineage of Coolify and Dokploy: connect a repo, get a build, watch it deploy behind a managed edge — from a dashboard that stays calm, fast, and honest about system state.

> **Status:** under active development. Interfaces and schemas still change without migration paths — not yet recommended for production workloads.

## What it does

- **Git-sourced services** — push to deploy: a BullMQ build worker builds images with Railpack and rolls them out to Docker/Swarm.
- **Databases** — one-click Postgres, Redis, MariaDB, MongoDB, ClickHouse, RabbitMQ, MinIO, and Meilisearch, with live pull/provision progress, connection strings, extensions, and a built-in data browser.
- **Compose stacks** — deploy multi-service `docker-compose` projects as a single resource.
- **Edge & networking** — Caddy-powered edge with multi-domain routing, automatic TLS, layer-4 database exposure, and Vercel-style deployment protection.
- **PR previews** — per-pull-request preview deployments with database branching and idle garbage collection.
- **Operations** — live project graph, build/deploy/edge logs, metrics, scheduled backups, notification channels, API keys, and org-scoped RBAC.
- **CLI** — `otterdeploy` command-line client for scripting and CI.

## Development setup

Requirements: [Bun](https://bun.sh), Docker (with compose), and [portless](https://www.npmjs.com/package/portless) for local HTTPS.

```bash
bun install

# one-time: local HTTPS proxy + CA trust
npm install -g portless
sudo portless trust

# each session
bun run proxy   # portless proxy on :443
bun run infra   # Postgres + supporting services via Docker Compose
bun run db:push # apply the schema
bun run dev     # web + API (everything except the build worker)
```

| Service | URL |
| ------- | --- |
| Web | `https://web.otterdeploy.local` |
| API | `https://api.otterdeploy.local` |

### Common scripts

- `bun run dev` — all apps in dev mode (excludes the builder)
- `bun run dev:web` / `bun run dev:server` — a single app
- `bun run build` — build everything
- `bun run test` — run the test suites
- `bun run typecheck` — TypeScript across the monorepo
- `bun run lint` / `bun run format` — Oxlint / Oxfmt
- `bun run db:studio` — database UI

## Monorepo layout

```
otterdeploy/
├── apps/
│   ├── web/         # Dashboard (React, TanStack Router)
│   ├── server/      # API server (Hono + oRPC)
│   ├── builder/     # BullMQ build worker — builds git-sourced services
│   ├── cli/         # End-user CLI (`otterdeploy`)
│   └── www/         # Marketing / docs site
├── packages/
│   ├── api/         # oRPC contracts, handlers, manifest schema
│   ├── auth/        # Authentication (Better Auth)
│   ├── db/          # Postgres schema & migrations (Drizzle)
│   ├── email/       # Email client & templates (Resend)
│   ├── jobs/        # Job queue — workers, triggers, registry (BullMQ)
│   └── shared/      # Shared types & utilities
```

Built with TypeScript end to end: Bun, Turborepo, Hono, oRPC, Zod, Drizzle, PostgreSQL, TanStack Router/DB, Tailwind, BullMQ, and Pino/OpenTelemetry for observability.

## License

Copyright © 2026 otterdeploy contributors.

Licensed under the [GNU Affero General Public License v3.0](./LICENSE) (AGPL-3.0). You can self-host, modify, and redistribute otterdeploy freely; if you offer a modified version as a network service, the AGPL requires you to make your modified source available to its users.
