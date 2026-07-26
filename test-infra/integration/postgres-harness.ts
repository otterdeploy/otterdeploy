/**
 * PostgreSQL 17 test harness for the bootstrap/upgrade integration suite
 * (od-5j8.1.1). Two modes, selected automatically:
 *
 *  - CI: `INTEGRATION_POSTGRES_URL` points at a `postgres:17` GitHub Actions
 *    service container (see .github/workflows/ci.yml, job `integration`).
 *  - Local dev: no env var set — we spin up a throwaway `postgres:17-alpine`
 *    container via the Docker CLI on a random high port and remove it when
 *    the suite finishes (`docker run --rm`).
 *
 * Either way, every test file gets its OWN uniquely-named database via
 * `createDatabase()`, dropped in `afterAll`, so the suite is hermetic and
 * never touches the developer's real `otterdeploy-postgres` dev container —
 * it only ever talks to the instance selected above.
 */
import { SQL } from "bun";
import { randomUUID } from "node:crypto";

export interface PostgresDatabase {
  url: string;
  drop: () => Promise<void>;
}

export interface PostgresInstance {
  /** Admin/maintenance connection URL (the instance's default "postgres" db). */
  adminUrl: string;
  createDatabase: (prefix: string) => Promise<PostgresDatabase>;
  /** Tears down the instance itself. No-op for an externally managed
   *  (CI service container) instance — only the ephemeral local container
   *  is actually stopped. */
  stop: () => Promise<void>;
}

/**
 * This module's only environment boundary, kept in one place. Read through a
 * function rather than a module constant so it still resolves at call time.
 * `INTEGRATION_POSTGRES_URL` is a harness-only variable supplied by CI, so it
 * deliberately isn't part of the validated `@otterdeploy/env` server schema.
 */
/* oxlint-disable-next-line node/no-process-env -- CI-supplied integration target, outside the server env schema */
const externalPostgresUrl = (): string | undefined => process.env.INTEGRATION_POSTGRES_URL;

/** Cheap, synchronous check so test files can `describe.skipIf` before ever
 *  touching the network — used both for the "is Docker present" gate and to
 *  decide whether we need to spin up a container at all. */
export function dockerAvailable(): boolean {
  try {
    const result = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Whether this suite has *some* way to reach a real Postgres 17 — either an
 *  externally provided instance (CI) or a local Docker daemon we can use to
 *  start one ourselves. Test files gate on this, not on `dockerAvailable()`
 *  directly, so CI (no local `docker run` needed — the service container is
 *  already running) and local dev (Docker required) both work. */
export function integrationRunnable(): boolean {
  return Boolean(externalPostgresUrl()) || dockerAvailable();
}

async function waitForPostgres(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new SQL({ url, max: 1 });
    try {
      await client.unsafe("select 1");
      await client.close();
      return;
    } catch (error) {
      lastError = error;
      await client.close().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new Error(`Postgres at ${url.replace(/:[^:@/]+@/, ":***@")} did not become ready: ${String(lastError)}`);
}

async function createDatabaseOn(adminUrl: string, prefix: string): Promise<PostgresDatabase> {
  const name = `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new SQL({ url: adminUrl, max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.close();
  }

  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${name}`;

  return {
    url: dbUrl.toString(),
    drop: async () => {
      const dropAdmin = new SQL({ url: adminUrl, max: 1 });
      try {
        // WITH (FORCE) (PG 13+) terminates any lingering connections from the
        // test run so the drop can never hang / fail on "database is being
        // accessed by other users".
        await dropAdmin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await dropAdmin.close();
      }
    },
  };
}

/** Uses `INTEGRATION_POSTGRES_URL` as-is when set (CI's postgres:17 service
 *  container — already running, nothing for us to start or stop). */
async function openExternalInstance(url: string): Promise<PostgresInstance> {
  await waitForPostgres(url);
  return {
    adminUrl: url,
    createDatabase: (prefix) => createDatabaseOn(url, prefix),
    stop: async () => {},
  };
}

/** Starts a throwaway `postgres:17-alpine` container on a spare high port for
 *  local development, where there is no CI service container to reuse. Never
 *  touches the developer's real `otterdeploy-postgres` dev container. */
async function startEphemeralContainer(): Promise<PostgresInstance> {
  const containerName = `otterdeploy-it-pg-${randomUUID().slice(0, 8)}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt++) {
    const port = 55432 + Math.floor(Math.random() * 4000);
    const run = Bun.spawnSync(
      [
        "docker",
        "run",
        "-d",
        "--rm",
        "--name",
        containerName,
        "-e",
        "POSTGRES_PASSWORD=postgres",
        "-e",
        "POSTGRES_USER=postgres",
        "-e",
        "POSTGRES_DB=postgres",
        "-p",
        `127.0.0.1:${port}:5432`,
        "postgres:17-alpine",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    if (run.exitCode === 0) {
      const adminUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
      await waitForPostgres(adminUrl);
      return {
        adminUrl,
        createDatabase: (prefix) => createDatabaseOn(adminUrl, prefix),
        stop: async () => {
          Bun.spawnSync(["docker", "rm", "-f", containerName], { stdout: "ignore", stderr: "ignore" });
        },
      };
    }

    lastError = run.stderr.toString();
    // Most likely a port collision — retry with a different random port.
  }

  throw new Error(`Failed to start ephemeral postgres:17 container after retries: ${String(lastError)}`);
}

export async function startPostgresInstance(): Promise<PostgresInstance> {
  const external = externalPostgresUrl();
  if (external) return openExternalInstance(external);
  if (!dockerAvailable()) {
    throw new Error(
      "No INTEGRATION_POSTGRES_URL and Docker is unavailable — call integrationRunnable() first and skip instead of calling startPostgresInstance().",
    );
  }
  return startEphemeralContainer();
}
