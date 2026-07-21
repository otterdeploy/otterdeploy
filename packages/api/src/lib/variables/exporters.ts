/**
 * Exporter registry — each resource type publishes a `Record<string, string>`
 * of variables that other resources can reference via `${{<Name>.<VAR>}}`.
 *
 * Exporters are pure given their input rows; recursion (for service refs
 * that themselves reference other resources) is handled by the resolver.
 */

import type {
  ResourceRow,
  ServicePortRow,
  ServiceResourceRow,
} from "../../routers/service/queries";

export interface PostgresExportInput {
  resource: ResourceRow;
  database: {
    internalConnectionString: string;
    internalHostname: string;
    internalPort: number;
    username: string;
    password: string;
    databaseName: string;
  };
}

export function postgresExports(input: PostgresExportInput): Record<string, string> {
  const db = input.database;
  return {
    DATABASE_URL: db.internalConnectionString,
    PGHOST: db.internalHostname,
    PGPORT: String(db.internalPort),
    PGUSER: db.username,
    PGPASSWORD: db.password,
    PGDATABASE: db.databaseName,
  };
}

export interface ServiceExportInput {
  resource: ResourceRow;
  service: ServiceResourceRow;
  ports: ServicePortRow[];
  resolvedEnv: Record<string, string>;
  /** All public domains of the service (its proxy routes), ordered
   *  primary-first. Empty/omitted when it isn't exposed on a domain yet. */
  domains?: string[];
}

/**
 * For service-to-service references, expose:
 *   - every resolved env var by its literal key
 *   - HOST = internalHostname
 *   - PORT = primary HTTP port (or first port)
 *   - URL  = http://<host>:<port>  (only if primary port is http; internal)
 *   - DOMAIN     = primary public domain          (only if exposed)
 *   - PUBLIC_URL = https://<primary-domain>        (only if exposed)
 *   - DOMAINS    = every public domain, comma-joined (only if exposed) — so a
 *                  consumer can wire up all of them, not just the primary
 */
export function serviceExports(input: ServiceExportInput): Record<string, string> {
  const primary =
    input.ports.find((p) => p.isPrimary && p.appProtocol === "http") ??
    input.ports.find((p) => p.appProtocol === "http") ??
    input.ports[0];

  const out: Record<string, string> = {
    ...input.resolvedEnv,
    HOST: input.service.internalHostname,
  };

  if (primary) {
    out.PORT = String(primary.containerPort);
    if (primary.appProtocol === "http") {
      out.URL = `http://${input.service.internalHostname}:${primary.containerPort}`;
    }
  }

  // Public domains — omitted (not empty) when the service has no route yet, so
  // the tokens simply don't appear rather than resolving to blank strings.
  const domains = input.domains ?? [];
  const primaryDomain = domains[0];
  if (primaryDomain) {
    out.DOMAIN = primaryDomain;
    out.PUBLIC_URL = `https://${primaryDomain}`;
    out.DOMAINS = domains.join(",");
  }

  return out;
}
