# otterstack

This project was created with [Better Fullstack](https://github.com/Marve10s/Better-Fullstack), a modern TypeScript stack that combines React, TanStack Router, Hono, ORPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **TailwindCSS** - CSS framework
- **shadcn/ui** - UI components
- **Hono** - Lightweight, performant server framework
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better Auth
- **Oxlint** - Oxlint + Oxfmt (linting & formatting)
- **TanStack DB** - Reactive client-first data store
- **Turborepo** - Optimized monorepo build system

## Getting Started

Install dependencies:

```bash
bun install
```

## Local Dev Setup

### 1. Install portless (global CLI)

```bash
npm install -g portless
```

### 2. Start the proxy (once)

```bash
sudo portless proxy start --https --tld io -p 443
sudo portless trust  # first time only — adds local CA to system trust store
```

### 3. Start infrastructure + dev servers

```bash
bun run infra  # starts Postgres + Inngest via Docker Compose
bun run dev    # starts web + API through portless
```

### Dev URLs

| Service | URL                          |
| ------- | ---------------------------- |
| Web     | `https://web.otterstack.io`  |
| API     | `https://api.otterstack.io`  |

## Database Setup

This project uses PostgreSQL with Drizzle ORM. The database runs via Docker Compose (`bun run infra`).

Apply the schema:

```bash
bun run db:push
```

## Git Hooks and Formatting

- Format and lint fix: `bun run check`

## Project Structure

```
otterstack/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Router)
│   └── server/      # Backend API (Hono, ORPC)
├── packages/
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Push schema changes to database
- `bun run db:studio`: Open database studio UI
- `bun run check`: Run Oxlint and Oxfmt
