/**
 * Pooled wire connections, keyed by target.
 *
 * The path this replaces spawned `docker exec … psql` per query: a process, a
 * TCP handshake and an auth round trip for every keystroke-triggered request.
 * Here a target keeps a small pool that is reused across requests and reaped
 * when idle, so the second query on a table costs a round trip rather than a
 * fork.
 *
 * Bun's built-in `SQL` speaks postgres, mysql and mariadb, which is exactly the
 * set the relational dialects cover — so this needs no new dependency and no
 * second driver to keep in step.
 *
 * READ-ONLY IS ENFORCED HERE, ON THE SERVER, not by classifying statements.
 * PostgreSQL receives a read-only startup parameter on every pooled connection;
 * MySQL operations run in a READ ONLY transaction. In both cases the database,
 * not client-side parsing, refuses a write.
 */
import type { Dialect } from "@otterdeploy/data-engine";

import { dialectForEngine } from "@otterdeploy/data-engine";
import { withTimeout } from "@otterdeploy/shared/promise";
import { Result } from "better-result";
import { SQL } from "bun";
import { createHash } from "node:crypto";
import { isIP } from "node:net";

import type { DataTarget } from "./target";

import { dataError } from "./errors";

/** Small: a workbench is interactive, not a batch job. */
const MAX_CONNECTIONS = 4;
/** Seconds a pooled connection may sit unused before it is reaped. */
const IDLE_TIMEOUT_SECONDS = 60;
/** Seconds before a connection is recycled regardless of use. */
const MAX_LIFETIME_SECONDS = 15 * 60;
/** Seconds to wait for the initial connect before calling the target down. */
const CONNECT_TIMEOUT_SECONDS = 10;
/** Queries are interactive; an unbounded statement must not pin a pool forever. */
const QUERY_TIMEOUT_MS = 30_000;
/** Milliseconds a pool may sit entirely unused before it is closed. */
const POOL_TTL_MS = 5 * 60 * 1000;

interface PooledClient {
  sql: SQL;
  dialect: Dialect;
  lastUsedAt: number;
}

const pools = new Map<string, PooledClient>();
let reaper: ReturnType<typeof setInterval> | null = null;

/**
 * Bun's SQL adapter name for a dialect.
 *
 * Read off the dialect rather than from a second engine list here: MariaDB
 * speaking MySQL's protocol is dialect knowledge, and keeping one source of it
 * stops "has a dialect" and "can be connected to" from drifting apart.
 */
function adapterFor(dialect: Dialect): "postgres" | "mysql" | null {
  return dialect.wireProtocol;
}

function startReaper(): void {
  if (reaper !== null) return;
  reaper = setInterval(() => {
    const now = Date.now();
    for (const [key, pooled] of pools) {
      if (now - pooled.lastUsedAt <= POOL_TTL_MS) continue;
      pools.delete(key);
      closeBestEffort(pooled.sql);
    }
    if (pools.size === 0 && reaper !== null) {
      clearInterval(reaper);
      reaper = null;
    }
  }, 60_000);
  // Never hold the process open just to reap idle database connections.
  reaper.unref?.();
}

export interface Connection {
  sql: SQL;
  dialect: Dialect;
  target: DataTarget;
}

/**
 * Get (or open) the pooled client for a target.
 *
 * Throws {@link DataError} rather than returning a Result because every caller
 * is already inside a `Result.tryPromise` boundary that maps thrown driver
 * failures through {@link toDataError}; a second error channel here would just
 * be unwrapped and rethrown at every call site.
 */
export function connect(target: DataTarget): Connection {
  const dialect = dialectForEngine(target.engine);
  if (!dialect) {
    throw dataError(
      "unsupported",
      `${target.engine} is not a SQL engine, so the relational workbench cannot serve it`,
    );
  }
  const adapter = adapterFor(dialect);
  if (!adapter) {
    throw dataError("unsupported", `no wire driver for ${target.engine}`);
  }

  const poolKey = effectivePoolKey(target);
  const existing = pools.get(poolKey);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return { sql: existing.sql, dialect: existing.dialect, target };
  }

  // No startup parameters (`options`): transaction-mode poolers — Neon,
  // PgBouncer, Supabase's pgbouncer — reject EVERY `-c` option with
  // "unsupported startup parameter", which made pooled databases unopenable.
  // Read-only is enforced by runOnConnection's server-side READ ONLY
  // transaction; runaway statements are cancelled client-side by awaitQuery.
  let readOnlyParams: Record<string, string> = {};
  if (target.mode === "read-only") {
    const params = dialect.readOnlyConnectionParams();
    if (params !== null) readOnlyParams = params;
  }

  const sql = new SQL({
    adapter,
    hostname: target.host,
    port: target.port,
    database: target.database,
    username: target.username,
    password: target.password,
    // SNI, not just `true`: providers that route by server name (Neon answers
    // "Endpoint ID is not specified" without it) need the hostname in the TLS
    // handshake. An object tls (resolveExternalTarget pins the host to an IP
    // and carries the real hostname as serverName) passes through untouched;
    // a plain `true` gets the target's own host as the server name, unless
    // that host is an IP literal, which is not a legal SNI value.
    tls:
      typeof target.tls === "boolean"
        ? target.tls && isIP(target.host) === 0
          ? { serverName: target.host }
          : target.tls
        : target.tls,
    max: MAX_CONNECTIONS,
    idleTimeout: IDLE_TIMEOUT_SECONDS,
    maxLifetime: MAX_LIFETIME_SECONDS,
    connectionTimeout: CONNECT_TIMEOUT_SECONDS,
    // Startup parameters, sent by the driver as each connection is established
    // and applied by the server itself.
    connection: readOnlyParams,
  });

  pools.set(poolKey, { sql, dialect, lastUsedAt: Date.now() });
  startReaper();
  return { sql, dialect, target };
}

/**
 * Run an operation with the target's read-only guarantee in force.
 *
 * `trustedRead` skips the READ ONLY transaction: the fence exists for
 * USER-AUTHORED SQL, where a statement classifier is not a boundary. A
 * statement this codebase compiled itself — browse, count, catalog
 * introspection, the version probe — cannot write by construction, and the
 * wrapper costs two extra round trips (BEGIN + COMMIT). Against a remote
 * database that is the difference between one network hop and three.
 */
export async function runOnConnection<T>(
  connection: Connection,
  operation: (sql: SQL) => Promise<T>,
  options: { trustedRead?: boolean } = {},
): Promise<T> {
  const needsReadOnlyTransaction =
    options.trustedRead !== true &&
    connection.target.mode === "read-only" &&
    connection.dialect.readOnlyConnectionParams() === null;
  return needsReadOnlyTransaction
    ? connection.sql.begin("read only", operation)
    : operation(connection.sql);
}

/** Await and cancel one Bun query at the common interactive timeout. */
export function awaitQuery<T>(query: SQL.Query<T>): Promise<T> {
  return withTimeout(query, QUERY_TIMEOUT_MS, "database query", () => query.cancel());
}
function effectivePoolKey(target: DataTarget): string {
  const identity = JSON.stringify([
    target.engine,
    target.host,
    target.port,
    target.database,
    target.username,
    target.password,
    target.tls,
    target.mode,
  ]);
  const fingerprint = createHash("sha256").update(identity).digest("hex");
  return `${target.poolKey}:${fingerprint}`;
}

function closeBestEffort(sql: SQL): void {
  void Result.tryPromise({ try: () => sql.close(), catch: () => undefined });
}
