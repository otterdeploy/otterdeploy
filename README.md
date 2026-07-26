<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/dist/lockup-dark@2x.png" />
  <img src="brand/dist/lockup-light@2x.png" alt="otterdeploy" width="306" height="64" />
</picture>

### Push to git. Deploy to your own servers.

A self-hostable deployment platform. Builds from a repo, managed databases, automatic HTTPS,
previews on every pull request — running on your hardware, with no usage bill.

<a href="https://otterdeploy.com">Website</a> ·
<a href="https://otterdeploy.com/docs">Documentation</a> ·
<a href="https://otterdeploy.com/docs/start/first-deploy">Quickstart</a> ·
<a href="https://otterdeploy.com/docs/cli">CLI</a> ·
<a href="https://github.com/otterdeploy/otterdeploy/issues">Issues</a>

[![CI](https://github.com/otterdeploy/otterdeploy/actions/workflows/ci.yml/badge.svg)](https://github.com/otterdeploy/otterdeploy/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/otterdeploy/otterdeploy?label=release&color=2563eb)](https://github.com/otterdeploy/otterdeploy/releases)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)

</div>

<!-- Hero screenshot goes here once we have one worth shipping:
     a real project view, light + dark, no seeded data.
     <picture>
       <source media="(prefers-color-scheme: dark)" srcset="brand/dist/hero-dark.png" />
       <img src="brand/dist/hero-light.png" alt="The otterdeploy project view" />
     </picture>
-->

## Why otterdeploy

Managed platforms are excellent right up to the point where the bill scales with your traffic, or
the thing you need isn't on the menu. The usual escape route is a VPS, a Dockerfile, a reverse
proxy, a certificate renewal cron, and a backup script you wrote once and never tested.

otterdeploy is the middle path: the control of running your own infrastructure with the ergonomics
of a managed one. Point it at a Linux box, connect a repo, and you get builds, rollouts, routing,
TLS, databases, backups, and logs — from a dashboard that stays calm, fast, and honest about what
the system is actually doing.

> [!WARNING]
> **Pre-1.0, under active development.** Interfaces and schemas still change without migration
> paths, so otterdeploy isn't recommended for production workloads yet — run it on something
> you'd be willing to rebuild.

## Install

One Linux box, one command:

```bash
curl -fsSL https://get.otterdeploy.com/install.sh | bash
```

The installer provisions the host, pulls the published images, puts Docker into Swarm mode, and
brings the stack up — with the host firewall and CrowdSec on by default. It installs from prebuilt
images, so no source checkout or build toolchain is needed on the server.

| Requirement | |
| --- | --- |
| **Host** | One Linux box with root |
| **Runtime** | Docker, Swarm-enabled by the installer |
| **Ports** | 80 and 443, for the edge and ACME |

Preview it without changing anything first:

```bash
curl -fsSL https://get.otterdeploy.com/install.sh | bash -s -- --dry-run
```

Then open the dashboard on port 3000 and follow the
[first deploy guide](https://otterdeploy.com/docs/start/first-deploy). Tunables (data directory,
version pin, ZFS branching pool, firewall opt-out) are documented in the
[install reference](https://otterdeploy.com/docs/start/install).

### CLI

```bash
npm install -g @otterdeploy/cli
```

Ships as `otterdeploy` with an `otd` alias — 34 commands for deploys, logs, environments, and CI.
See the [CLI reference](https://otterdeploy.com/docs/cli).

### Uninstall

```bash
curl -fsSL https://get.otterdeploy.com/uninstall.sh | sudo bash
```

Shows what's on the host, asks item by item what to remove, then requires you to type `wipe`.
Volumes, `/data/otterdeploy`, the ZFS pool, Swarm and Docker are each opt-out — but the defaults
**do delete your data**. Add `-s -- --dry-run` to preview. See the
[uninstall reference](https://otterdeploy.com/docs/start/install#uninstalling).

## Everything you need

<table>
<tr>
<td width="33%" valign="top">

**Build & deploy**

Framework auto-detect · Dockerfile builds · Monorepo aware · Compose stacks · 18 stack templates · Rollback · Crash reporting · Environments

</td>
<td width="33%" valign="top">

**Edge & networking**

Multi-domain routing · Automatic TLS · Custom certificates · Layer-4 exposure · Deployment protection · Access logs · Edge events · CrowdSec

</td>
<td width="33%" valign="top">

**Data**

Postgres · Redis · MariaDB · MongoDB · ClickHouse · Built-in data browser · Encrypted backups · Scheduled snapshots · Volumes & mounts

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Operate**

Live logs · CPU & memory metrics · Web terminal · Multi-node Swarm · Tailscale & NetBird mesh · Host health alerts · Slack, Discord, PagerDuty · Raw Docker

</td>
<td width="33%" valign="top">

**Access & security**

Org RBAC · Scoped API keys · Audit log · Sealed variables · Host firewall · SSH keys · Private registries · Anomaly alerts

</td>
<td width="33%" valign="top">

**Automate**

`otterdeploy.json` · Typed oRPC API · 34 CLI commands · Outbound webhooks · Inbound triggers · Device login · CI tokens · Shell completions

</td>
</tr>
</table>

Pull requests get their own preview deployment with database branching and idle garbage collection.
Databases branch copy-on-write when ZFS is available, and fall back to logical snapshots when it
isn't — the installer never blocks on it.

## How a deploy works

```
push → pending → building (railpack) → image pushed → rollout (swarm) → route (caddy) → tls issued
```

A commit lands, the API queues a build, and a BullMQ worker builds an image with
[Railpack](https://railpack.com) and pushes it to your registry. Docker Swarm rolls the service out,
Caddy picks up the route, and ACME issues the certificate. Each of those states is a real state in
the schema, shown as-is in the dashboard — no spinner standing in for a failure.

## Contributing

Requirements: [Bun](https://bun.sh), Docker (with compose), and
[portless](https://www.npmjs.com/package/portless) for local HTTPS.

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

The dashboard comes up at `https://web.otterdeploy.local`, the API at
`https://api.otterdeploy.local`.

| Script | |
| --- | --- |
| `bun run dev` | All apps in dev mode (excludes the builder) |
| `bun run dev:web` / `dev:server` | A single app |
| `bun run build` | Build everything |
| `bun run test` | Run the test suites |
| `bun run typecheck` | TypeScript across the monorepo |
| `bun run lint` / `format` | Oxlint / Oxfmt |
| `bun run db:studio` | Database UI |

Before opening a pull request, run `bun run typecheck`, `bun run lint`, and `bun run test`. UI work
should be read against [`PRODUCT.md`](./PRODUCT.md) and [`DESIGN.md`](./DESIGN.md) first — they are
the design system of record, and "Coming soon" is always preferred over seeded data.

<details>
<summary><strong>Monorepo layout</strong></summary>

```
otterdeploy/
├── apps/
│   ├── web/         # Dashboard (React, TanStack Router)
│   ├── server/      # API server (Hono + oRPC)
│   ├── builder/     # BullMQ build worker — builds git-sourced services
│   ├── cli/         # End-user CLI (`otterdeploy` / `otd`)
│   └── www/         # Marketing site & docs (otterdeploy.com)
├── packages/
│   ├── api/         # oRPC contracts, handlers, manifest schema
│   ├── auth/        # Authentication (Better Auth)
│   ├── db/          # Postgres schema & migrations (Drizzle)
│   ├── email/       # Email client & templates (Resend)
│   ├── jobs/        # Job queue — workers, triggers, registry (BullMQ)
│   └── shared/      # Shared types & utilities
├── brand/           # Logo geometry + generated assets (build output — don't hand-edit)
└── scripts/         # install.sh, uninstall.sh, maintenance scripts
```

</details>

## Built with

TypeScript end to end — [Bun](https://bun.sh), [Turborepo](https://turbo.build),
[Hono](https://hono.dev), [oRPC](https://orpc.unnoq.com), [Zod](https://zod.dev),
[Drizzle](https://orm.drizzle.team), [PostgreSQL](https://www.postgresql.org),
[TanStack](https://tanstack.com) Router/DB, [Tailwind](https://tailwindcss.com),
[BullMQ](https://bullmq.io), and Pino/OpenTelemetry for observability. Deploys run on
[Docker Swarm](https://docs.docker.com/engine/swarm/) behind [Caddy](https://caddyserver.com).

## License

Copyright © 2026 otterdeploy contributors.

Licensed under the [GNU Affero General Public License v3.0](./LICENSE). You can self-host, modify,
and redistribute otterdeploy freely; if you offer a modified version as a network service, the AGPL
requires you to make your modified source available to its users.
