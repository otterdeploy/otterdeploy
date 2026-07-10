/**
 * Per-engine live-stat probes for the org database catalog. Each collector
 * reuses the data-viewer's exec channel for its engine (psql / redis-cli /
 * mysql / mongosh inside the database's own container — creds never touch the
 * overlay network) and normalizes to one nullable shape:
 *
 *   { sizeBytes, connections, maxConnections, serverVersion }
 *
 * Honesty rules: every field is independently nullable, engines without a
 * cheap probe return all-null, and callers wrap the whole probe in a short
 * timeout — a hung database yields `stats: null`, never a stuck page. The
 * pure output parsers live in catalog-shared.ts (leaf, unit-tested).
 */
import type { DbConnInfo } from "./query";

import {
  type CatalogStats,
  EMPTY_STATS,
  type MongoStatsPayload,
  parseMariadbStats,
  parseMongoStats,
  parsePostgresStatsRow,
  parseRedisInfoStats,
} from "./catalog-shared";
import { withMysql } from "./mariadb";
import { mongoEvalJson } from "./mongo";
import { runReadOnlyQuery } from "./query";
import { redisInfoRaw } from "./redis";

const POSTGRES_STATS_SQL = `
  SELECT pg_database_size(current_database())::text AS size_bytes,
         (SELECT count(*) FROM pg_stat_activity)::text AS connections,
         current_setting('max_connections') AS max_connections,
         current_setting('server_version') AS server_version
`;

async function collectPostgresStats(conn: DbConnInfo): Promise<CatalogStats> {
  const grid = await runReadOnlyQuery(conn, POSTGRES_STATS_SQL, 1);
  return parsePostgresStatsRow(grid.rows[0]);
}

async function collectRedisStats(conn: DbConnInfo): Promise<CatalogStats> {
  return parseRedisInfoStats(await redisInfoRaw(conn));
}

const MARIADB_SIZE_SQL =
  "SELECT COALESCE(SUM(data_length + index_length), 0), @@max_connections, VERSION() " +
  "FROM information_schema.tables " +
  "WHERE table_schema NOT IN ('information_schema','mysql','performance_schema','sys')";

const MARIADB_THREADS_SQL = "SHOW GLOBAL STATUS LIKE 'Threads_connected'";

async function collectMariadbStats(conn: DbConnInfo): Promise<CatalogStats> {
  return withMysql(conn, async (run) => {
    const [sizeOut, threadsOut] = await Promise.all([
      run(MARIADB_SIZE_SQL),
      run(MARIADB_THREADS_SQL),
    ]);
    return parseMariadbStats(sizeOut, threadsOut);
  });
}

// serverStatus needs broader privileges than db.stats(); tolerate its absence
// so connections degrade to null instead of nuking the whole probe.
const MONGO_STATS_EXPR = `(() => {
  const s = db.stats();
  let c = null;
  try { c = db.serverStatus().connections; } catch (e) {}
  return {
    dataSize: s.dataSize,
    current: c ? c.current : null,
    available: c ? c.available : null,
    version: db.version(),
  };
})()`;

async function collectMongoStats(conn: DbConnInfo): Promise<CatalogStats> {
  return parseMongoStats(await mongoEvalJson<MongoStatsPayload>(conn, MONGO_STATS_EXPR));
}

/**
 * Collect live stats for one running database. Engines without a probe
 * (clickhouse / rabbitmq / minio / meilisearch) return all-null immediately —
 * the UI renders "—", never invented numbers.
 */
export async function collectEngineStats(conn: DbConnInfo): Promise<CatalogStats> {
  switch (conn.engine) {
    case "postgres":
      return collectPostgresStats(conn);
    case "redis":
      return collectRedisStats(conn);
    case "mariadb":
      return collectMariadbStats(conn);
    case "mongodb":
      return collectMongoStats(conn);
    default:
      return EMPTY_STATS;
  }
}
