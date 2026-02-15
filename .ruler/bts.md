# Better-T-Stack Project Rules

This is a otterstack project created with Better-T-Stack CLI.

## Project Structure

This is a monorepo with the following structure:

- **`apps/web/`** - Frontend application (React with TanStack Router)

- **`apps/server/`** - Backend server (Hono)

- **`packages/api/`** - Shared API logic and types
- **`packages/auth/`** - Authentication logic and utilities
- **`packages/db/`** - Database schema and utilities
- **`packages/env/`** - Shared environment variables and validation
- **`packages/config/`** - Shared TypeScript configuration

## Available Scripts

- `bun run dev` - Start all apps in development mode
- `bun run dev:web` - Start only the web app
- `bun run dev:server` - Start only the server
- `bun run build` - Build all apps
- `bun run lint` - Lint all packages
- `bun run typecheck` - Type check all packages

## Database Commands

All database operations should be run from the server workspace:

- `bun run db:push` - Push schema changes to database
- `bun run db:studio` - Open database studio
- `bun run db:generate` - Generate Drizzle files
- `bun run db:migrate` - Run database migrations

Database schema files are located in `packages/db/src/schema/`

## API Structure

- oRPC contracts and routers are in `packages/api/src/`
- Client-side oRPC client is in `apps/web/src/utils/orpc.ts`

## Authentication

Authentication is powered by Better Auth:

- Auth configuration is in `packages/auth/src/`
- Web app auth client is in `apps/web/src/lib/auth-client.ts`

## Project Configuration

This project includes a `bts.jsonc` configuration file that stores your Better-T-Stack settings:

- Contains your selected stack configuration (database, ORM, backend, frontend, etc.)
- Used by the CLI to understand your project structure
- Safe to delete if not needed

## Key Points

- This is a Turborepo monorepo using bun workspaces
- Each app has its own `package.json` and dependencies
- Run commands from the root to execute across all workspaces
- Run workspace-specific commands with `bun run command-name`
- Turborepo handles build caching and parallel execution
