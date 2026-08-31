/**
 * Dialect registry. One lookup, keyed by the engine the resource actually runs,
 * so callers never branch on engine names themselves.
 *
 * `null` is a first-class answer: Redis and MongoDB are not SQL and must not be
 * handed a relational workbench. That was the one thing `UnsupportedDataViewer`
 * got right, and it survives the rewrite as a type rather than a card.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";

import type { Dialect } from "../dialect";
import type { DialectId } from "../types";

import { clickhouseDialect } from "./clickhouse";
import { mysqlDialect } from "./mysql";
import { postgresDialect } from "./postgres";

export { classifyClickhouseType, clickhouseDialect } from "./clickhouse";
export { classifyMysqlType, mysqlDialect } from "./mysql";
export { classifyPostgresType, postgresDialect } from "./postgres";

export const DIALECTS: Record<DialectId, Dialect> = {
  postgres: postgresDialect,
  mysql: mysqlDialect,
  clickhouse: clickhouseDialect,
};

const BY_ENGINE: ReadonlyMap<DatabaseEngine, Dialect> = new Map(
  Object.values(DIALECTS).flatMap((d) => d.engines.map((e) => [e, d] as const)),
);

/** The dialect for an engine, or null when the engine is not relational. */
export function dialectForEngine(engine: DatabaseEngine): Dialect | null {
  return BY_ENGINE.get(engine) ?? null;
}

/** True when this engine has a SQL dialect at all. */
export function isRelationalEngine(engine: DatabaseEngine): boolean {
  return BY_ENGINE.has(engine);
}

/**
 * True when the workbench can actually CONNECT to this engine.
 *
 * Narrower than {@link isRelationalEngine}: ClickHouse has a complete dialect
 * that compiles correct SQL, but no wire driver, so routing it to the workbench
 * would produce a surface that fails the moment it opens.
 */
export function hasWireDriver(engine: DatabaseEngine): boolean {
  return BY_ENGINE.get(engine)?.wireProtocol != null;
}
