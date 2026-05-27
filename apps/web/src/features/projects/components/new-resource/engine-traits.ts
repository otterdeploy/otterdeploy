// Per-engine UI traits for the create-wizard. Keeps engine differences in
// one place so step files stop sprouting `kind.id === "postgres"` ladders
// (and silently rendering postgres copy when the operator picked redis).
//
// Mirrors what `packages/api/src/swarm/database-engines/*` already knows
// server-side — we re-state the small subset the wizard needs because the
// adapter type isn't shipped to the browser bundle.

export type EngineId =
  | "postgres"
  | "mariadb"
  | "mysql"
  | "redis"
  | "mongodb"
  | "clickhouse"
  | (string & {});

export interface EngineTraits {
  /** Default network port the engine listens on inside the cluster. */
  port: number | "auto";
  /** Container-side mount path for the persistent volume. */
  mountTarget: string;
  /** Whether "Database name" is a meaningful concept (postgres/mariadb/mongodb yes, redis no). */
  hasNamedDatabase: boolean;
  /** Word used for the writable unit — "Database name" vs "Instance name". */
  nameLabel: string;
  /** Supports continuous backups / PITR-style recovery. */
  supportsPitr: boolean;
  /** Standby-replica failover model fits this engine. */
  supportsHaReplica: boolean;
  /** Public exposure is operationally safe by default (postgres/mariadb behind TLS yes; redis no). */
  publicExposureRecommended: boolean;
  /** One-line explanation rendered under the "Access" toggle. */
  accessSub: string;
  /** Pooler name used in copy ("PgBouncer" / "Connection pooler"). */
  poolerName: string | null;
}

const TRAITS: Record<string, EngineTraits> = {
  postgres: {
    port: 5432,
    mountTarget: "/var/lib/postgresql/data",
    hasNamedDatabase: true,
    nameLabel: "Database name",
    supportsPitr: true,
    supportsHaReplica: true,
    publicExposureRecommended: true,
    accessSub:
      "Public access wires the Caddy proxy at the public hostname. Off keeps the DB on the internal network only — safer default.",
    poolerName: "PgBouncer",
  },
  mariadb: {
    port: 3306,
    mountTarget: "/var/lib/mysql",
    hasNamedDatabase: true,
    nameLabel: "Database name",
    supportsPitr: true,
    supportsHaReplica: true,
    publicExposureRecommended: true,
    accessSub:
      "Public access wires the Caddy proxy at the public hostname. Off keeps the DB on the internal network only — safer default.",
    poolerName: "ProxySQL",
  },
  mysql: {
    port: 3306,
    mountTarget: "/var/lib/mysql",
    hasNamedDatabase: true,
    nameLabel: "Database name",
    supportsPitr: true,
    supportsHaReplica: true,
    publicExposureRecommended: true,
    accessSub:
      "Public access wires the Caddy proxy at the public hostname. Off keeps the DB on the internal network only — safer default.",
    poolerName: "ProxySQL",
  },
  redis: {
    port: 6379,
    mountTarget: "/data",
    hasNamedDatabase: false,
    nameLabel: "Instance name",
    supportsPitr: false,
    supportsHaReplica: false,
    publicExposureRecommended: false,
    accessSub:
      "Exposing a cache to the public internet is rarely a good idea — keep it on the internal network unless you really mean it.",
    poolerName: null,
  },
  mongodb: {
    port: 27017,
    mountTarget: "/data/db",
    hasNamedDatabase: true,
    nameLabel: "Database name",
    supportsPitr: false,
    supportsHaReplica: true,
    publicExposureRecommended: false,
    accessSub:
      "Public access wires the Caddy proxy at the public hostname. Off keeps the DB on the internal network only — safer default.",
    poolerName: null,
  },
  clickhouse: {
    port: 9000,
    mountTarget: "/var/lib/clickhouse",
    hasNamedDatabase: true,
    nameLabel: "Database name",
    supportsPitr: false,
    supportsHaReplica: true,
    publicExposureRecommended: false,
    accessSub:
      "Public access wires the Caddy proxy at the public hostname. Off keeps the DB on the internal network only — safer default.",
    poolerName: null,
  },
};

const FALLBACK: EngineTraits = {
  port: "auto",
  mountTarget: "/data",
  hasNamedDatabase: true,
  nameLabel: "Service name",
  supportsPitr: false,
  supportsHaReplica: false,
  publicExposureRecommended: false,
  accessSub:
    "Exposing this service to the public internet is opt-in. Off keeps it on the internal network.",
  poolerName: null,
};

export function traitsFor(engineId: string): EngineTraits {
  return TRAITS[engineId] ?? FALLBACK;
}
