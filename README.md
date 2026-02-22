# Otterdeploy

Open-source platform for declarative infrastructure management. Define your services, databases, and dependencies as code, deploy across multiple environments, and manage everything from a real-time dashboard.

## What is Otterdeploy?

Otterdeploy is a self-hosted PaaS that lets you declare your entire infrastructure in a single config file and sync it to your servers. Think Heroku/Railway-style developer experience, but you own the platform.

- **Declarative config** &mdash; Define resources (APIs, web apps, workers, databases, caches, volumes), environment variables, domains, and links in one file
- **Multi-environment** &mdash; Production, staging, dev &mdash; with deep inheritance so you only override what changes
- **Real-time dashboard** &mdash; Manage projects, visualize architecture, trigger deployments, monitor resources
- **Git-driven deploys** &mdash; Connect GitHub repos and deploy on push
- **Secrets management** &mdash; Infisical integration with native breakglass fallback
- **Multi-tenancy** &mdash; Organizations with role-based access (owner, admin, member, viewer)

## Tech Stack

| Layer     | Technology                                                      |
| --------- | --------------------------------------------------------------- |
| Frontend  | React, TanStack Router, TanStack Query, Tailwind CSS, shadcn/ui |
| Backend   | Hono, oRPC (end-to-end type-safe RPC)                           |
| Database  | PostgreSQL 16, Drizzle ORM                                      |
| Auth      | Better Auth                                                     |
| Real-time | Rocicorp Zero                                                   |
| Jobs      | Inngest                                                         |
| CLI       | TypeScript, Zod, YAML                                           |
| Monorepo  | Turborepo, Bun                                                  |

## Project Structure

```
otterdeploy/
├── apps/
│   ├── web/           # React frontend (Vite + TanStack Router)
│   ├── server/        # Hono API server
│   ├── worker/        # Inngest job worker
│   ├── cli/           # otterdeploy CLI
│   └── fumadocs/      # Documentation site (Next.js)
├── packages/
│   ├── api/           # oRPC routers & procedures
│   ├── auth/          # Better Auth configuration
│   ├── contract/      # Shared Zod schemas & types
│   ├── db/            # Drizzle schema & queries
│   ├── domain/        # Business logic services
│   ├── env/           # Environment variable validation
│   ├── events/        # Inngest event definitions
│   ├── infra-config/  # Config loader, differ, reconciler
│   ├── logger/        # Pino logging
│   ├── secrets/       # Secrets management
│   ├── ui/            # Shared UI components
│   └── zero/          # Zero reactive queries & mutators
└── docker-compose.yml
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.3.7
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- PostgreSQL 16 (provided via Docker)

### Setup

```bash
# Clone the repo
git clone https://github.com/your-org/otterdeploy.git
cd otterstack

# Install dependencies
bun install

# Copy environment config
cp .env.example .env

# Start infrastructure (PostgreSQL, Inngest, Zero Cache)
bun run infra:up

# Push database schema
bun run db:push

# Start all apps in development
bun run dev
```

The web app will be available at `http://otterdeploy.localhost:1355`.

## Usage

### Infrastructure Config

Define your infrastructure in `otterdeploy.config.ts` (or `otterdeploy.yaml`):

```typescript
import { defineConfig } from "@otterdeploy/infra-config";

export default defineConfig({
  project: "my-app",
  organization: "org_abc123",

  environments: {
    production: {
      resources: {
        api: {
          kind: "api",
          source: { github: "my-org/api", branch: "main" },
          build: {
            builder: "nixpacks",
            buildCommand: "npm run build",
          },
          deploy: {
            startCommand: "node dist/index.js",
            replicas: 3,
            healthcheckPath: "/health",
            restartPolicy: "ON_FAILURE",
            region: "us-west",
          },
          domain: ["api.myapp.com", "api-v2.myapp.com"],
          env: {
            NODE_ENV: "production",
            DATABASE_URL: "${db.connectionString}",
          },
        },
        db: {
          kind: "database",
          image: "postgres:16",
          storage: "20Gi",
          env: { POSTGRES_DB: "myapp" },
        },
      },
      links: [{ from: "api", to: "db", type: "depends_on" }],
    },

    staging: {
      extends: "production",
      exclude: ["redis"],
      overrides: {
        resources: {
          api: {
            source: { branch: "develop" },
            deploy: { replicas: 1 },
            domain: "api.staging.myapp.com",
            env: { NODE_ENV: "staging" },
          },
        },
      },
    },
  },
});
```

YAML configs (`otterdeploy.yaml`) are also supported with the same schema.

### CLI Commands

```bash
# Initialize a config template
otterdeploy init

# Preview changes without applying
otterdeploy preview

# Sync config to infrastructure
otterdeploy sync

# Check current state vs config
otterdeploy status

# Tear down all resources
otterdeploy destroy
```

### Environment Inheritance

Environments support deep inheritance to minimize duplication:

- **`extends`** &mdash; Inherit all resources and links from a parent environment
- **`exclude`** &mdash; Remove specific resources from the parent
- **`overrides`** &mdash; Deep-merge changes into inherited resources (source, build, deploy, and env are merged field-by-field)
- **`excludeEnv`** &mdash; Remove specific env vars from an inherited resource
- **`extraLinks`** / **`removeLinks`** &mdash; Add or remove individual links without replacing all of them

## Development

### Available Scripts

```bash
# Development
bun run dev              # Start all apps
bun run dev:web          # Start web only
bun run dev:server       # Start server only

# Database
bun run db:push          # Push schema changes
bun run db:studio        # Open Drizzle Studio
bun run db:generate      # Generate migration files
bun run db:migrate       # Run migrations
bun run db:seed -- --reset --count=20

# Infrastructure
bun run infra:up         # Start Docker services
bun run infra:preview    # Preview infra changes
bun run infra:sync       # Apply infra changes

# Quality
bun run check-types      # TypeScript type checking
bun run check            # Oxlint + Oxfmt
bun run build            # Build all packages
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable              | Description                     |
| --------------------- | ------------------------------- |
| `DATABASE_URL`        | PostgreSQL connection string    |
| `BETTER_AUTH_SECRET`  | Auth session secret (32+ chars) |
| `BETTER_AUTH_URL`     | Auth base URL                   |
| `CORS_ORIGIN`         | Allowed CORS origin             |
| `INNGEST_EVENT_KEY`   | Inngest event key               |
| `INNGEST_SIGNING_KEY` | Inngest signing key             |
| `VITE_SERVER_URL`     | Server URL for the frontend     |
| `VITE_ZERO_URL`       | Zero Cache URL for the frontend |

## Architecture

### How Config Sync Works

```
otterdeploy.config.ts
        │
        ▼
   loadConfig()          Parse & validate (TS or YAML)
        │
        ▼
 resolveEnvironments()   Expand inheritance (6-step algorithm)
        │
        ▼
 resolveReferences()     Resolve ${resource.property} in env vars
        │
        ▼
  getCurrentState()      Fetch current state from database
        │
        ▼
   computeDiff()         Compare desired vs current → changeset
        │
        ▼
  applyChangeset()       Execute create/update/delete actions
```

### Resource Kinds

| Kind       | Description                      |
| ---------- | -------------------------------- |
| `web`      | Frontend web application         |
| `api`      | Backend API service              |
| `worker`   | Background job processor         |
| `database` | PostgreSQL, MySQL, MariaDB, etc. |
| `cache`    | Redis, KeyDB, Dragonfly, etc.    |
| `volume`   | Persistent storage               |

### Build Options

| Builder      | Description                              |
| ------------ | ---------------------------------------- |
| `nixpacks`   | Auto-detect language and build (default) |
| `dockerfile` | Build from a Dockerfile                  |
| `buildpack`  | Cloud Native Buildpacks                  |
| `railpack`   | Railpack builder                         |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run type checking (`bun run check-types`)
5. Commit your changes (`git commit -m "feat: add my feature"`)
6. Push to your fork (`git push origin feat/my-feature`)
7. Open a Pull Request

### Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` &mdash; New feature
- `fix:` &mdash; Bug fix
- `docs:` &mdash; Documentation
- `refactor:` &mdash; Code refactoring
- `chore:` &mdash; Maintenance tasks

## License

See [LICENSE](LICENSE) for details.
