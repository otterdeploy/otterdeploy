// Safe test defaults for env validation, mirroring packages/api/vitest.setup.ts
// for this package's `bun test` runner. `@otterdeploy/env/server` validates
// `process.env` at IMPORT time, so a test that transitively imports a module
// reading env (the terminal ticket store, the db client, authz) throws
// "Invalid environment variables" before a single assertion runs. Bun loads
// this via `[test] preload` in bunfig.toml, i.e. before any test module is
// imported. `??=` so a real configured value always wins: this never weakens
// or overrides an env var that is actually set.
// oxlint-disable-next-line node/no-process-env -- test env setup boundary: this file IS the env setup, run before any test module imports the validated env schema.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.REDIS_URL ??= "redis://localhost:6379";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.CORS_ORIGIN ??= "http://localhost:3000";
