/**
 * Resolving "which database, reached how".
 *
 * A target is deliberately a value, not a resource id: the runtime above it
 * does not care whether the credentials came from a managed `database_resource`
 * row or from an external connection string an operator pasted in, and keeping
 * that distinction out of the execute path is what lets the same workbench
 * serve both.
 *
 * `mode` is carried on the target rather than passed per call, because
 * read-only has to be a property of the SESSION. A per-statement check is a
 * classifier, and a classifier can be defeated by a CTE or a stored procedure.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import type { DataConnectionId, OrganizationId, ResourceId, UserId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { dataConnection, databaseResource, project, resource } from "@otterdeploy/db/schema";
import { env } from "@otterdeploy/env/server";
import { and, eq, or } from "drizzle-orm";

import { decryptForDomain } from "../lib/crypto";
import { parseConnectionUrl, resolveConnectionAddress } from "./connection-url";
import { dataError } from "./errors";

export type AccessMode = "read-only" | "read-write";

export interface DataTarget {
  /** Stable key for the connection pool. Never contains the password. */
  poolKey: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** TLS for external targets; managed ones ride a loopback tunnel. */
  tls: boolean | Bun.TLSOptions;
  mode: AccessMode;
  /** Target policy before this individual call requested a mode. */
  writeAllowed: boolean;
  /** Present for managed targets, so audit rows can name the resource. */
  resourceId: ResourceId | null;
  /** Present for external targets, so audit rows can name the connection. */
  connectionId: DataConnectionId | null;
  /** Human label for logs and error messages. Never a secret. */
  label: string;
}

/**
 * Resolve a managed database resource to a target.
 *
 * Reached through the caller's session tunnel (`via`): a loopback port on
 * the control plane that an exec relays into the database's container. The
 * alias on the project's network is NOT used — the control plane is not on
 * that network, by design (docs/designs/workbench-managed-reach.md). The
 * tunnel's scope is part of the pool key so a session's connections are its
 * own and are closed with it.
 */
export async function resolveManagedTarget(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
  mode: AccessMode;
  via: { host: string; port: number; scope: string };
}): Promise<DataTarget> {
  const [row] = await db
    .select({
      engine: databaseResource.engine,
      username: databaseResource.username,
      password: databaseResource.password,
      databaseName: databaseResource.databaseName,
      internalHostname: databaseResource.internalHostname,
      internalPort: databaseResource.internalPort,
      resourceId: resource.id,
      resourceName: resource.name,
      projectSlug: project.slug,
    })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(databaseResource.resourceId, input.resourceId),
        eq(project.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!row) {
    throw dataError("not_found", `database ${input.resourceId} not found`);
  }

  return {
    // Mode is part of the key: a read-only and a read-write session against the
    // same database must never share a pooled connection, or the read-only
    // guarantee lasts exactly until someone else's write checks the socket out.
    poolKey: `res:${input.via.scope}:${row.resourceId}:${input.mode}`,
    engine: row.engine,
    host: input.via.host,
    port: input.via.port,
    database: row.databaseName,
    username: row.username,
    password: row.password,
    tls: false,
    mode: input.mode,
    writeAllowed: true,
    resourceId: row.resourceId,
    connectionId: null,
    label: `${row.projectSlug}/${row.resourceName}`,
  };
}

/**
 * Resolve a saved external connection to a target.
 *
 * The URL is decrypted HERE and used HERE. No procedure returns it, because a
 * workbench that shipped the URL to the browser would be handing every viewer a
 * credential for a database otterdeploy does not run and cannot rotate.
 *
 * `visibility: "private"` rows are only resolvable by their creator; `org` rows
 * by anyone in the organization. The org filter is in the WHERE clause rather
 * than a post-fetch check, so a row from another org cannot be read at all.
 */
export async function resolveExternalTarget(input: {
  organizationId: OrganizationId;
  connectionId: DataConnectionId;
  viewerId: UserId | null;
  /** What the caller ASKED for; a production connection pins read-only. */
  mode: AccessMode;
}): Promise<DataTarget> {
  const [row] = await db
    .select({
      id: dataConnection.id,
      name: dataConnection.name,
      engine: dataConnection.engine,
      encryptedUrl: dataConnection.encryptedUrl,
      visibility: dataConnection.visibility,
      environment: dataConnection.environment,
      defaultAccess: dataConnection.defaultAccess,
      requireTls: dataConnection.requireTls,
      createdBy: dataConnection.createdBy,
    })
    .from(dataConnection)
    .where(
      and(
        eq(dataConnection.id, input.connectionId),
        eq(dataConnection.organizationId, input.organizationId),
        // A private connection is its creator's alone. Expressed as a predicate
        // so the row never leaves the database for anyone else.
        input.viewerId === null
          ? eq(dataConnection.visibility, "org")
          : or(eq(dataConnection.visibility, "org"), eq(dataConnection.createdBy, input.viewerId)),
      ),
    )
    .limit(1);

  if (!row) {
    throw dataError("not_found", `connection ${input.connectionId} not found`);
  }

  const url = await decryptForDomain(row.encryptedUrl, "data-connections");
  const allowPrivateAddresses = env.DATA_ALLOW_PRIVATE_CONNECTIONS === true;
  const parsed = parseConnectionUrl(url, { allowPrivateAddresses });
  if (parsed.isErr()) {
    // The URL passed validation when it was SAVED, so a failure here means the
    // stored value is corrupt rather than that the user typed something wrong.
    throw dataError("not_found", "this connection's stored URL is unreadable");
  }
  const resolved = await resolveConnectionAddress(parsed.value.host, { allowPrivateAddresses });
  if (resolved.isErr()) {
    throw dataError("denied", resolved.error.message);
  }

  // A production connection is read-only no matter what was asked for. This is
  // the write gate: the deliberate, audited act is changing the CONNECTION, not
  // approving each edit.
  const mode: AccessMode =
    row.environment === "production"
      ? "read-only"
      : row.defaultAccess === "read-only"
        ? "read-only"
        : input.mode;
  const writeAllowed = row.environment !== "production" && row.defaultAccess === "read-write";
  const tls = row.requireTls || parsed.value.sslRequested;

  return {
    poolKey: `conn:${row.id}:${mode}`,
    engine: row.engine,
    host: resolved.value.address,
    port: parsed.value.port,
    database: parsed.value.database,
    username: parsed.value.username,
    password: parsed.value.password,
    // External hops cross the public internet, so TLS unless the row opted out.
    tls:
      tls && resolved.value.serverName !== null ? { serverName: resolved.value.serverName } : tls,
    mode,
    writeAllowed,
    resourceId: null,
    connectionId: row.id,
    label: row.name,
  };
}
