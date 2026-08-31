/**
 * Deterministic derivation of a database's INTERNAL identity + connection
 * string from its name. Everything here is a pure function of
 * (engine, projectSlug, resourceName, password) (no DB, no docker) so it can
 * run at stage time (to show the pending panel real credentials) and at deploy
 * time (to provision with those same credentials) and produce identical output.
 *
 * The single source of truth for the `${projectSlug}_${resourceSlug}_*` naming:
 * both `createPostgresResourceStream` and the draft-credentials endpoint call
 * this, so the values the operator copies before deploy keep working after.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";

import { PLATFORM } from "../../../constants";
import { getEngineAdapter } from "../../../swarm";
import { clampPostgresIdentifier, sanitizeDatabaseName, sanitizeProjectSlug } from "../views";

export interface InternalDbCredentials {
  databaseName: string;
  username: string;
  password: string;
  internalHostname: string;
  internalPort: number;
  internalConnectionString: string;
}

export function deriveInternalDbCredentials(input: {
  engine: DatabaseEngine;
  /** Raw project slug, sanitized here. */
  projectSlug: string;
  /** Raw resource (database) name, sanitized here. */
  resourceName: string;
  password: string;
  /** Set when this database lives on a SHARED SERVER. The database name and
   *  username stay the resource's own (they are already namespaced by project
   *  slug, so two tenants can never collide on one server); only the address
   *  changes, because a tenant answers on its host's hostname and port. */
  host?: { internalHostname: string; internalPort: number } | null;
  /** Environment scope suffix (`-staging`), from `scopeSuffix()`. Empty for
   *  main and for unstamped rows, so every already-deployed database keeps the
   *  hostname it has — only a NON-main environment takes one.
   *
   *  Applied to the HOSTNAME only. The database name and username are already
   *  namespaced by project slug and are the identity a dump/restore round-trips
   *  through, so scoping them would rename an existing tenant's schema for no
   *  uniqueness gain. The hostname is the one that collides: it has no
   *  environment in it and `database_resource_internal_hostname_unique` is
   *  global, so a staging `postgres` fails to INSERT beside production's
   *  (od-jwx). */
  scopeSuffix?: string;
}): InternalDbCredentials {
  const adapter = getEngineAdapter(input.engine);
  const resourceSlug = sanitizeDatabaseName(input.resourceName);
  const projectSlug = sanitizeProjectSlug(input.projectSlug);
  const databaseName = clampPostgresIdentifier(`${projectSlug}_${resourceSlug}_db`);
  const username = clampPostgresIdentifier(`${projectSlug}_${resourceSlug}_user`);
  // A tenant answers on its HOST's hostname, which already carries the host's
  // own scope; only a database with its own container takes the suffix.
  const internalHostname =
    input.host?.internalHostname ??
    `${resourceSlug}${input.scopeSuffix ?? ""}.${projectSlug}.${PLATFORM.database.internalBaseDomain}`;
  const internalPort = input.host?.internalPort ?? adapter.port;
  const internalConnectionString = adapter.buildConnectionString({
    username,
    password: input.password,
    host: internalHostname,
    port: internalPort,
    databaseName,
    // Mongo tenants authenticate against their own database (see the adapter).
    ...(input.host && input.engine === "mongodb" ? { authSource: databaseName } : {}),
  });
  return {
    databaseName,
    username,
    password: input.password,
    internalHostname,
    internalPort,
    internalConnectionString,
  };
}
