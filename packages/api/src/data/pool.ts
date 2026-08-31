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
 * READ-ONLY IS ENFORCED HERE, ON THE SESSION, not per statement. A read-only
 * pool issues the dialect's read-only statement on every connection it opens,
 * so the server refuses writes no matter what SQL arrives. That is the property
 * a lexical classifier cannot give you, and it is why `mode` is part of the
 * pool key.
 */
import type { Dialect } from "@otterdeploy/data-engine";

import { dialectForEngine } from "@otterdeploy/data-engine";
import { SQL } from "bun";

import type { DataTarget } from "./target";

import { DataError } from "./errors";

/** Small: a workbench is interactive, not a batch job. */
const MAX_CONNECTIONS = 4;
/** Seconds a pooled connection may sit unused before it is reaped. */
const IDLE_TIMEOUT_SECONDS = 60;
/** Seconds before a connection is recycled regardless of use. */
const MAX_LIFETIME_SECONDS = 15 * 60;
/** Seconds to wait for the initial connect before calling the target down. */
const CONNECT_TIMEOUT_SECONDS = 10;
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
      void pooled.sql.close();
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
    throw new DataError(
      "unsupported",
      `${target.engine} is not a SQL engine, so the relational workbench cannot serve it`,
    );
  }
  const adapter = adapterFor(dialect);
  if (!adapter) {
    throw new DataError("unsupported", `no wire driver for ${target.engine}`);
  }

  const existing = pools.get(target.poolKey);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return { sql: existing.sql, dialect: existing.dialect, target };
  }

  // Read-only is a SERVER-side session default applied at connect, so it holds
  // for every statement on every connection this pool opens. When the dialect
  // has no such parameter we refuse outright rather than falling back to a
  // statement classifier for a security property — a CTE or a stored procedure
  // defeats a classifier, and the caller has a real alternative (a read-only role).
  let readOnlyParams: Record<string, string> = {};
  if (target.mode === "read-only") {
    const params = dialect.readOnlyConnectionParams();
    if (params === null) {
      throw new DataError(
        "denied",
        `${target.engine} cannot be made read-only at connect time; use a connection whose role is read-only instead`,
      );
    }
    readOnlyParams = params;
  }

  const sql = new SQL({
    adapter,
    hostname: target.host,
    port: target.port,
    database: target.database,
    username: target.username,
    password: target.password,
    tls: target.tls,
    max: MAX_CONNECTIONS,
    idleTimeout: IDLE_TIMEOUT_SECONDS,
    maxLifetime: MAX_LIFETIME_SECONDS,
    connectionTimeout: CONNECT_TIMEOUT_SECONDS,
    // Startup parameters, sent by the driver as each connection is established
    // and applied by the server itself.
    connection: readOnlyParams,
  });

  pools.set(target.poolKey, { sql, dialect, lastUsedAt: Date.now() });
  startReaper();
  return { sql, dialect, target };
}

/** Close and forget one target's pool. Used when credentials rotate. */
export async function evict(poolKey: string): Promise<void> {
  const pooled = pools.get(poolKey);
  if (!pooled) return;
  pools.delete(poolKey);
  await pooled.sql.close();
}

/** Close every pool. Called on shutdown and between integration tests. */
export async function closeAllPools(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  if (reaper !== null) {
    clearInterval(reaper);
    reaper = null;
  }
  await Promise.all(open.map((p) => p.sql.close()));
}

/** Pool keys currently open. Diagnostics only; never contains a password. */
export function openPoolKeys(): string[] {
  return [...pools.keys()];
}
