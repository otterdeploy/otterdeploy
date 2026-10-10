/**
 * Changing a managed database's password ON THE ENGINE.
 *
 * Every engine we provision bakes its password into the container env at
 * create time (`POSTGRES_PASSWORD`, `MARIADB_PASSWORD`, `MONGO_INITDB_*`), and
 * every one of those images reads that env ONCE, at first boot, to initialise
 * the data directory. After that the credential lives inside the data: editing
 * the env and rolling the container changes nothing. A rotation therefore has
 * to be a statement against the running engine, which is what this module
 * plans.
 *
 * Statements are built here and executed by the caller over the same
 * docker-exec admin transport tenancy uses (database-hosting/internals.ts), so
 * they are unit testable without a container. Like tenancy.ts, every
 * identifier and literal is quoted by the private helpers below.
 *
 * Only engines whose password can be changed in place get a plan:
 *   - postgres  `ALTER ROLE ... PASSWORD`, then (optionally) the sessions that
 *               authenticated before the change are ended;
 *   - mariadb   `ALTER USER` for the app user, and for `root` on a dedicated
 *               server: the image sets root's password to the same value
 *               (MARIADB_ROOT_PASSWORD), so leaving root alone would leave the
 *               old password working as a superuser;
 *   - mongodb   `changeUserPassword` in the database the user lives in.
 * Redis takes its password as a `--requirepass` flag and bakes it into the
 * container's healthcheck, so changing it means recreating the container; and
 * ClickHouse has no wired admin credential. Both get no plan, and the caller
 * reports that rather than half-rotating.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";

import type { HostAdmin, TenantStatement } from "./tenancy";

/** The credential being rotated, as the database row records it. */
export interface RotationIdentity {
  username: string;
  databaseName: string;
  /** The CURRENT password: the login for a database with its own container. */
  password: string;
}

export interface PasswordRotationPlan {
  /** Who runs the statements. The database's own superuser for a dedicated
   *  container; the HOST's admin for a tenant on a shared server. */
  login: HostAdmin;
  statements: TenantStatement[];
}

/** Quote a SQL identifier for postgres (embedded double quotes doubled). */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a SQL text literal (embedded single quotes doubled). */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A JS string literal safe to embed in a `mongosh --eval` script. */
function jsLiteral(value: string): string {
  return JSON.stringify(value);
}

function postgresPlan(identity: RotationIdentity, next: string, host: HostAdmin | null) {
  return {
    login: host ?? identity,
    statements: [
      { sql: `ALTER ROLE ${quoteIdent(identity.username)} WITH PASSWORD ${literal(next)};` },
    ],
  };
}

function mariadbPlan(identity: RotationIdentity, next: string, host: HostAdmin | null) {
  const user = `${literal(identity.username)}@'%'`;
  if (host) {
    return {
      login: host,
      statements: [{ sql: `ALTER USER ${user} IDENTIFIED BY ${literal(next)}; FLUSH PRIVILEGES;` }],
    };
  }
  // Root, not the app user: only root may change root's password, and root
  // carries the same secret (see the module note). One exec, one session, so
  // the login that authenticated with the old password finishes the batch.
  return {
    login: { username: "root", password: identity.password, databaseName: identity.databaseName },
    statements: [
      {
        sql: [
          `ALTER USER ${user} IDENTIFIED BY ${literal(next)};`,
          `ALTER USER IF EXISTS 'root'@'%' IDENTIFIED BY ${literal(next)};`,
          `ALTER USER IF EXISTS 'root'@'localhost' IDENTIFIED BY ${literal(next)};`,
          `FLUSH PRIVILEGES;`,
        ].join(" "),
      },
    ],
  };
}

function mongodbPlan(identity: RotationIdentity, next: string, host: HostAdmin | null) {
  // A dedicated container's user is its root, which lives in `admin`; a
  // tenant's user was created in the tenant's own database (tenancy.ts).
  const userDb = host ? identity.databaseName : "admin";
  return {
    login: host ?? identity,
    statements: [
      {
        sql: `db.getSiblingDB(${jsLiteral(userDb)}).changeUserPassword(${jsLiteral(identity.username)}, ${jsLiteral(next)});`,
      },
    ],
  };
}

const PLANS = {
  postgres: postgresPlan,
  mariadb: mariadbPlan,
  mongodb: mongodbPlan,
} satisfies Partial<
  Record<
    DatabaseEngine,
    (identity: RotationIdentity, next: string, host: HostAdmin | null) => PasswordRotationPlan
  >
>;

/** An engine whose password can be rotated in place. */
export type RotatableEngine = keyof typeof PLANS;

/** Can this engine's password be rotated in place? */
export function isRotatableEngine(engine: DatabaseEngine): engine is RotatableEngine {
  return Object.hasOwn(PLANS, engine);
}

/**
 * The statements that move `identity` to `nextPassword`. `host` is the shared
 * server's admin when the database is a tenant, null when it owns its
 * container.
 */
export function passwordRotationPlan(input: {
  engine: RotatableEngine;
  identity: RotationIdentity;
  nextPassword: string;
  host: HostAdmin | null;
}): PasswordRotationPlan {
  return PLANS[input.engine](input.identity, input.nextPassword, input.host);
}

/**
 * Postgres only: the engine's own clock, read right after the ALTER, so the
 * session cut-off below compares like with like (the control plane's clock is
 * not the database's).
 */
export const POSTGRES_NOW_STATEMENT: TenantStatement = { sql: "SELECT now()::text;" };

/**
 * Postgres only: end every session `username` opened before `cutoff` (a
 * timestamp the engine printed). Those sessions authenticated with the old
 * password, and `ALTER ROLE` does not touch a session that is already open, so
 * without this a leaked password keeps whatever connection it already has.
 * Prints how many sessions it ended.
 */
export function postgresEndSessionsStatement(username: string, cutoff: string): TenantStatement {
  return {
    sql: `SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = ${literal(username)} AND backend_start < ${literal(cutoff)}::timestamptz AND pid <> pg_backend_pid();`,
  };
}
