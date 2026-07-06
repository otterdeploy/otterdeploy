/**
 * Ref resolution for the manifest reconciler. Builds the `${database:…}` /
 * `${service:…}` lookup table from the project's DB rows and substitutes those
 * refs into service env values at write time.
 */
import type { ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";

import { isSecretSentinel, parseRefs } from "../../stack/manifest";
import { ManifestApplySkipError } from "./errors";

export interface DatabaseRefView {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  url: string;
}

export interface RefTable {
  databases: Map<string, DatabaseRefView>;
  services: Map<string, { host: string }>;
}

export interface ResolvedEnv {
  values: Array<{ key: string; value: string }>;
  skipped: ManifestApplySkipError[];
}

export async function loadRefTable(projectId: ProjectId): Promise<RefTable> {
  const [dbRows, svcRows] = await Promise.all([
    db
      .select({ resource, database: databaseResource })
      .from(resource)
      .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
      .where(eq(resource.projectId, projectId)),
    db
      .select({ resource, service: serviceResource })
      .from(resource)
      .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
      .where(eq(resource.projectId, projectId)),
  ]);

  const databases = new Map<string, DatabaseRefView>();
  for (const row of dbRows) {
    databases.set(row.resource.name, {
      host: row.database.internalHostname,
      port: row.database.internalPort,
      username: row.database.username,
      password: row.database.password,
      database: row.database.databaseName,
      url: row.database.internalConnectionString,
    });
  }

  const services = new Map<string, { host: string }>();
  for (const row of svcRows) {
    services.set(row.resource.name, { host: row.service.internalHostname });
  }

  return { databases, services };
}

/**
 * Diff-time companion to {@link resolveEnv}: resolve one declared env value
 * the way the write path will, or null when it can't be (missing resource,
 * unsupported ref, `${secret}`). The diff compares this against the stored
 * row — apply writes RESOLVED values, so comparing raw ref text guaranteed a
 * permanent phantom "update".
 */
export function makeEnvRefResolver(refs: RefTable): (raw: string) => string | null {
  return (raw) => {
    if (isSecretSentinel(raw)) return null;
    const substituted = interpolate(raw, refs);
    return substituted.unresolved.length > 0 ? null : substituted.value;
  };
}

export function resolveEnv(
  serviceName: string,
  desired: Record<string, string> | undefined,
  refs: RefTable,
  currentServerEnv: Record<string, string>,
): ResolvedEnv {
  const values: ResolvedEnv["values"] = [];
  const skipped: ManifestApplySkipError[] = [];

  for (const [key, raw] of Object.entries(desired ?? {})) {
    if (isSecretSentinel(raw)) {
      const existing = currentServerEnv[key];
      if (existing === undefined) {
        skipped.push(
          new ManifestApplySkipError({
            resource: "env",
            name: `${serviceName}.${key}`,
            reason:
              "declared as ${secret} but no value set — run `otterdeploy env set` before applying",
          }),
        );
        continue;
      }
      values.push({ key, value: existing });
      continue;
    }

    const substituted = interpolate(raw, refs);
    if (substituted.unresolved.length > 0) {
      skipped.push(
        new ManifestApplySkipError({
          resource: "env",
          name: `${serviceName}.${key}`,
          reason: `unresolved reference(s): ${substituted.unresolved.join(", ")}`,
        }),
      );
      continue;
    }
    values.push({ key, value: substituted.value });
  }

  return { values, skipped };
}

// Resolve a `${database:<name>.<field>}` ref against the DB-backed view. The
// view's fields are all string|number scalars, so coerce to string explicitly.
function resolveDatabaseRef(
  refs: RefTable,
  name: string,
  tail: string,
  whole: string,
  unresolved: string[],
): string {
  const dbRef = refs.databases.get(name);
  if (!dbRef) {
    unresolved.push(`\${database:${name}.${tail}} (database not found)`);
    return whole;
  }
  const value = (dbRef as unknown as Record<string, string | number>)[tail];
  if (value === undefined) {
    unresolved.push(whole);
    return whole;
  }
  return typeof value === "string" ? value : String(value);
}

function resolveServiceRef(
  refs: RefTable,
  name: string,
  tail: string,
  whole: string,
  unresolved: string[],
): string {
  const svcRef = refs.services.get(name);
  if (!svcRef) {
    unresolved.push(`\${service:${name}.${tail}} (service not found)`);
    return whole;
  }
  if (tail === "host") return svcRef.host;
  // service-env and port refs land here — Phase 5 will extend the ref table;
  // for now they remain unresolved.
  unresolved.push(whole);
  return whole;
}

function interpolate(raw: string, refs: RefTable): { value: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const tokens = parseRefs(raw);
  if (tokens.length === 0) return { value: raw, unresolved };

  const out = raw.replace(/\$\{([^}]+)\}/g, (whole, body: string) => {
    if (body === "secret") return whole; // handled upstream
    const colonIdx = body.indexOf(":");
    if (colonIdx === -1) {
      unresolved.push(whole);
      return whole;
    }
    const namespace = body.slice(0, colonIdx);
    const rest = body.slice(colonIdx + 1);
    const dotIdx = rest.indexOf(".");
    if (dotIdx === -1) {
      unresolved.push(whole);
      return whole;
    }
    const name = rest.slice(0, dotIdx);
    const tail = rest.slice(dotIdx + 1);

    if (namespace === "database") return resolveDatabaseRef(refs, name, tail, whole, unresolved);
    if (namespace === "service") return resolveServiceRef(refs, name, tail, whole, unresolved);

    unresolved.push(whole);
    return whole;
  });

  return { value: out, unresolved };
}
