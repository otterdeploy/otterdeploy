// Safe test defaults for env validation. `@otterdeploy/env/server` runs a
// `@t3-oss/env-core` `createEnv` that validates `process.env` at import time;
// when a test transitively imports a module that reads env (e.g. the db
// client, authz/tokens), missing required vars throw "Invalid environment
// variables". This setup file runs before any test module is imported, so it
// satisfies every REQUIRED (non-optional, no-default) field in
// packages/env/src/server.ts. `??=` so a real value from the environment
// always wins — we never weaken or override a configured var.
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
