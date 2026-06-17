/**
 * Deterministic derivation of a database's INTERNAL identity + connection
 * string from its name. Everything here is a pure function of
 * (engine, projectSlug, resourceName, password) — no DB, no docker — so it can
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
import {
  clampPostgresIdentifier,
  sanitizeDatabaseName,
  sanitizeProjectSlug,
} from "../views";

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
  /** Raw project slug — sanitized here. */
  projectSlug: string;
  /** Raw resource (database) name — sanitized here. */
  resourceName: string;
  password: string;
}): InternalDbCredentials {
  const adapter = getEngineAdapter(input.engine);
  const resourceSlug = sanitizeDatabaseName(input.resourceName);
  const projectSlug = sanitizeProjectSlug(input.projectSlug);
  const databaseName = clampPostgresIdentifier(`${projectSlug}_${resourceSlug}_db`);
  const username = clampPostgresIdentifier(`${projectSlug}_${resourceSlug}_user`);
  const internalHostname = `${resourceSlug}.${projectSlug}.${PLATFORM.database.internalBaseDomain}`;
  const internalConnectionString = adapter.buildConnectionString({
    username,
    password: input.password,
    host: internalHostname,
    port: adapter.port,
    databaseName,
  });
  return {
    databaseName,
    username,
    password: input.password,
    internalHostname,
    internalPort: adapter.port,
    internalConnectionString,
  };
}
