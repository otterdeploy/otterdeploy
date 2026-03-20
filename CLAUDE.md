# otterstack

This file provides context about the project for AI assistants.

## Project Overview

- **Ecosystem**: Typescript

## Tech Stack

- **Runtime**: bun
- **Package Manager**: bun

### Frontend

- Framework: tanstack-router
- CSS: tailwind
- UI Library: shadcn-ui

### Backend

- Framework: hono
- API: orpc
- Validation: zod

### Database

- Database: postgres
- ORM: drizzle

### Authentication

- Provider: better-auth

### Additional Features

- Testing: vitest
- AI: vercel-ai
- Email: resend
- Payments: polar
- Job Queue: inngest
- Logging: pino
- Observability: opentelemetry

## Project Structure

```
otterstack/
├── apps/
│   ├── web/         # Frontend application
│   └── server/      # Backend API
├── packages/
│   ├── api/         # API layer
│   ├── auth/        # Authentication
│   ├── db/          # Database schema
│   ├── email/       # Email (Resend) client & templates
│   └── inngest/     # Job queue (Inngest) client, functions & triggers
```

## Common Commands

- `bun install` - Install dependencies
- `bun dev` - Start development server
- `bun build` - Build for production
- `bun test` - Run tests
- `bun db:push` - Push database schema
- `bun db:studio` - Open database UI

## Maintenance

Keep CLAUDE.md updated when:

- Adding/removing dependencies
- Changing project structure
- Adding new features or services
- Modifying build/dev workflows

AI assistants should suggest updates to this file when they notice relevant changes.
