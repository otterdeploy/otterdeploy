/**
 * Stack-database backup source resolution.
 *
 * A database running INSIDE a compose stack is a materialized `service_resource`
 * (its `stackId` is set), not a first-class managed `database_resource`. It has
 * no engine/credential row, so we derive them: the ENGINE from the service's
 * image, the CREDENTIALS from its resolved env bag (POSTGRES_* / MYSQL_* /
 * MONGO_INITDB_*). The container itself is already labelled
 * `otterdeploy.resource.id=<serviceId>`, so the existing backup container lookup
 * and the dump→rustic pipeline run UNCHANGED once this target is resolved.
 *
 * Detection is declarative-by-selection, not heuristic: a stack service is only
 * ever treated as a database because the operator added it to a backup schedule,
 * and only if its image is one of the recognised database images below. We never
 * auto-classify a stack's containers.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource, serviceResource } from "@otterdeploy/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";

import { resolveServiceEnv } from "../lib/variables/resolver";

/** Engines an image can map to. Matches the backup engine's own set; `redis`
 *  is recognised only to reject it (no logical dump — use a volume backup). */
type DumpEngine = "postgres" | "mariadb" | "mongodb" | "redis";
/** The engines that actually produce a logical dump. */
type DumpableEngine = Exclude<DumpEngine, "redis">;

export interface StackDumpTarget {
  engine: DumpableEngine;
  databaseName: string;
  username: string;
  password: string;
  resourceName: string;
  projectId: ProjectId;
  projectSlug: string;
}

// Base image name → engine. A deliberately narrow allow-list, NOT a keyword
// scan: paired with declarative-by-selection (above), it avoids Coolify's
// image-sniffing + hand-maintained exclusion-list treadmill.
const IMAGE_ENGINE: Record<string, DumpEngine> = {
  postgres: "postgres",
  postgis: "postgres",
  pgvector: "postgres",
  mariadb: "mariadb",
  mysql: "mariadb", // mysqldump-compatible
  mongo: "mongodb",
  mongodb: "mongodb",
  redis: "redis",
  valkey: "redis",
  keydb: "redis",
  dragonfly: "redis",
};

/** Strip registry + tag + digest to the bare image name
 *  (`ghcr.io/x/postgres:16` → `postgres`, `registry:5000/mysql` → `mysql`). */
function baseImageName(image: string): string {
  const noDigest = image.split("@")[0] ?? image;
  const lastSlash = noDigest.lastIndexOf("/");
  const lastColon = noDigest.lastIndexOf(":");
  // A ':' before the last '/' is a registry port, not a tag — keep it.
  const repo = lastColon > lastSlash ? noDigest.slice(0, lastColon) : noDigest;
  return (repo.split("/").pop() ?? repo).toLowerCase();
}

/** The managed-DB engine a compose service's image maps to, or null when the
 *  image isn't a recognised database. */
export function engineFromImage(image: string): DumpEngine | null {
  return IMAGE_ENGINE[baseImageName(image)] ?? null;
}

/** Whether an image is a dumpable database (recognised AND not redis — redis has
 *  no logical dump, same as managed redis; those want a volume backup). */
function isDumpableDatabaseImage(image: string): boolean {
  const engine = engineFromImage(image);
  return engine != null && engine !== "redis";
}

interface Creds {
  databaseName: string;
  username: string;
  password: string;
}

function postgresCreds(env: Record<string, string>): Creds | null {
  const username = env.POSTGRES_USER ?? "postgres";
  const password = env.POSTGRES_PASSWORD ?? "";
  if (!password) return null;
  return { username, password, databaseName: env.POSTGRES_DB ?? username };
}

function mariadbCreds(env: Record<string, string>): Creds | null {
  const username = env.MARIADB_USER ?? env.MYSQL_USER ?? "root";
  const password =
    username === "root"
      ? (env.MARIADB_ROOT_PASSWORD ?? env.MYSQL_ROOT_PASSWORD ?? "")
      : (env.MARIADB_PASSWORD ?? env.MYSQL_PASSWORD ?? "");
  const databaseName = env.MARIADB_DATABASE ?? env.MYSQL_DATABASE ?? "";
  if (!password || !databaseName) return null;
  return { username, password, databaseName };
}

function mongodbCreds(env: Record<string, string>): Creds | null {
  const username = env.MONGO_INITDB_ROOT_USERNAME ?? "";
  const password = env.MONGO_INITDB_ROOT_PASSWORD ?? "";
  if (!username || !password) return null;
  return { username, password, databaseName: env.MONGO_INITDB_DATABASE ?? "admin" };
}

/** Credentials for the dump, by engine convention, pulled from the container's
 *  resolved env. Returns null when a required field is absent (e.g. no password)
 *  so the run fails as unresolvable rather than dumping with blank credentials. */
function credsFromEnv(engine: DumpableEngine, env: Record<string, string>): Creds | null {
  switch (engine) {
    case "postgres":
      return postgresCreds(env);
    case "mariadb":
      return mariadbCreds(env);
    case "mongodb":
      return mongodbCreds(env);
    default:
      return null;
  }
}

/** Resolve a compose-stack service into a dump target. Returns null when the
 *  resource isn't a stack DB service, its image isn't a dumpable database, or
 *  its credentials can't be resolved from the env bag. */
export async function resolveStackDumpTarget(
  resourceId: ResourceId,
): Promise<StackDumpTarget | null> {
  const [row] = await db
    .select({
      image: serviceResource.image,
      stackId: serviceResource.stackId,
      name: resource.name,
      projectId: resource.projectId,
      projectSlug: project.slug,
    })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(serviceResource.resourceId, resourceId))
    .limit(1);
  if (!row || !row.stackId) return null; // not a compose service
  const engine = engineFromImage(row.image);
  if (!engine || engine === "redis") return null;

  // Resolve the service's env (refs → final values) — the same env the running
  // container sees, so credentials are read from the source of truth.
  const resolved = await resolveServiceEnv(row.projectId, resourceId);
  if (resolved.isErr()) return null;
  const creds = credsFromEnv(engine, resolved.value);
  if (!creds) return null;

  return {
    engine,
    databaseName: creds.databaseName,
    username: creds.username,
    password: creds.password,
    resourceName: row.name,
    projectId: row.projectId,
    projectSlug: row.projectSlug,
  };
}

/** Compose-stack services in the org whose image is a recognised (dumpable)
 *  database — the candidate set the schedule source classifier matches against. */
export async function listStackDatabaseResources(
  organizationId: OrganizationId,
): Promise<Array<{ id: ResourceId; name: string }>> {
  const rows = await db
    .select({ id: resource.id, name: resource.name, image: serviceResource.image })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(and(eq(project.organizationId, organizationId), isNotNull(serviceResource.stackId)));
  return rows
    .filter((r) => isDumpableDatabaseImage(r.image))
    .map((r) => ({ id: r.id, name: r.name }));
}
