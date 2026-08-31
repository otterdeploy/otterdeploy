/**
 * Managing external database connections.
 *
 * The URL goes in and never comes out. Every procedure here either stores it
 * (encrypted, under its own secret domain) or reports something derived from
 * it; none returns it, because a workbench that shipped the URL to the browser
 * would hand every viewer a working credential for a database otterdeploy does
 * not run and cannot rotate.
 */
import type { DataConnectionId, OrganizationId, UserId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { dataConnection } from "@otterdeploy/db/schema";
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { and, desc, eq, or } from "drizzle-orm";

import type { ParsedConnectionUrl } from "../../data/connection-url";

import { requirePermission } from "../..";
import {
  connect,
  describeConnection,
  execute,
  parseConnectionUrl,
  resolveExternalTarget,
} from "../../data";
import { encryptForDomain } from "../../lib/crypto";
import { publishOrgBusEvent } from "../project/project-event-bus";

/** Row shape every procedure here returns. Never includes the URL. */
const SELECTION = {
  id: dataConnection.id,
  name: dataConnection.name,
  engine: dataConnection.engine,
  displayHost: dataConnection.displayHost,
  displayDatabase: dataConnection.displayDatabase,
  visibility: dataConnection.visibility,
  environment: dataConnection.environment,
  defaultAccess: dataConnection.defaultAccess,
  requireTls: dataConnection.requireTls,
  createdAt: dataConnection.createdAt,
  lastConnectedAt: dataConnection.lastConnectedAt,
};

/**
 * Whether this instance may connect to private addresses.
 *
 * Off unless the operator turns it on. Someone running otterdeploy alongside a
 * database on the same host is a real case, but it has to be an instance-level
 * decision — otherwise any member could reach the metadata service or another
 * tenant's overlay address by pasting a URL.
 */
function allowsPrivateAddresses(): boolean {
  return env.DATA_ALLOW_PRIVATE_CONNECTIONS === true;
}

/** Rows this viewer may see: org-visible, plus their own private ones. */
function visibleTo(organizationId: OrganizationId, viewerId: UserId | null) {
  return and(
    eq(dataConnection.organizationId, organizationId),
    viewerId === null
      ? eq(dataConnection.visibility, "org")
      : or(eq(dataConnection.visibility, "org"), eq(dataConnection.createdBy, viewerId)),
  );
}

/**
 * Announce a row to the org, so every open client applies it WITHOUT refetching.
 *
 * Only `org`-visible rows are published. A private connection belongs to its
 * creator, and pushing it to the whole organization would leak the existence of
 * a database — and its host — to people the visibility rule exists to exclude.
 * The creator's own client already has the row from the mutation response.
 */
function announce(organizationId: OrganizationId, row: ConnectionRow): void {
  if (row.visibility !== "org") return;
  publishOrgBusEvent(organizationId, {
    kind: "data-connections",
    op: "upsert",
    rows: [
      {
        ...row,
        createdAt: row.createdAt.toISOString(),
        lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
      },
    ],
  });
}

/** Announce a removal — a real delete, or a row that left org visibility. */
function publishDeleted(organizationId: OrganizationId, id: string): void {
  publishOrgBusEvent(organizationId, { kind: "data-connections", op: "delete", keys: [id] });
}

/** The row shape every handler here returns and announces. Never the URL. */
interface ConnectionRow {
  id: string;
  name: string;
  engine: "postgres" | "mariadb";
  displayHost: string;
  displayDatabase: string;
  visibility: "org" | "private";
  environment: "production" | "other";
  defaultAccess: "read-only" | "read-write";
  requireTls: boolean;
  createdAt: Date;
  lastConnectedAt: Date | null;
}

/**
 * A throwaway read-only target for a URL that exists only in this request.
 *
 * Keyed by a HASH of the whole URL: the same credential re-tested reuses the
 * client, a corrected password gets a fresh one, and the key itself never
 * holds anything reversible. Never a way to acquire a writable session.
 */
function draftTarget(url: string, p: ParsedConnectionUrl): Parameters<typeof connect>[0] {
  return {
    poolKey: `testurl:${Bun.hash(url).toString(36)}`,
    engine: p.engine,
    host: p.host,
    port: p.port,
    database: p.database,
    username: p.username,
    password: p.password,
    tls: p.sslRequested,
    mode: "read-only",
    resourceId: null,
    connectionId: null,
    label: "connection test",
  };
}

/** Open the connection once and read the server's version string. */
async function probeVersion(target: Parameters<typeof connect>[0]) {
  const connection = connect(target);
  const startedAt = performance.now();
  const grid = await execute(connection, { sql: "SELECT version()", params: [] });
  if (grid.isErr()) return grid;
  const cell = grid.value.rows[0]?.[0];
  return Result.ok({
    durationMs: Math.round(performance.now() - startedAt),
    serverVersion: cell !== null && cell !== undefined && "v" in cell ? String(cell.v) : "",
  });
}

export function makeConnectionHandlers(deps: {
  viewerIdOf: (context: { session?: { user?: { id?: string } } | null }) => UserId | null;
}) {
  return {
    listConnections: requirePermission({ database: ["read"] }).data.listConnections.handler(
      async ({ context }) => {
        const rows = await db
          .select(SELECTION)
          .from(dataConnection)
          .where(visibleTo(context.activeOrganizationId, deps.viewerIdOf(context)))
          .orderBy(desc(dataConnection.createdAt));
        return { connections: rows };
      },
    ),

    createConnection: requirePermission({ database: ["write"] }).data.createConnection.handler(
      async ({ input, context, errors }) => {
        const parsed = parseConnectionUrl(input.url, {
          allowPrivateAddresses: allowsPrivateAddresses(),
        });
        if (parsed.isErr()) {
          throw errors.INVALID_URL({ data: { reason: parsed.error.message } });
        }
        const described = describeConnection(parsed.value);

        context.log.set({
          // The host and database, never the URL: this row is readable by
          // operators for 90 days.
          dataConnection: { name: input.name, ...described, engine: parsed.value.engine },
        });

        const encryptedUrl = await encryptForDomain(input.url, "data-connections");
        const [row] = await db
          .insert(dataConnection)
          .values({
            organizationId: context.activeOrganizationId,
            name: input.name,
            engine: parsed.value.engine,
            encryptedUrl,
            displayHost: described.displayHost,
            displayDatabase: described.displayDatabase,
            visibility: input.visibility,
            environment: input.environment,
            defaultAccess: input.defaultAccess,
            requireTls: input.requireTls,
            createdBy: deps.viewerIdOf(context),
          })
          .returning(SELECTION);

        if (!row) throw errors.NOT_FOUND();
        announce(context.activeOrganizationId, row);
        return row;
      },
    ),

    updateConnection: requirePermission({ database: ["write"] }).data.updateConnection.handler(
      async ({ input, context, errors }) => {
        const viewerId = deps.viewerIdOf(context);
        const patch: Record<string, unknown> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.visibility !== undefined) patch.visibility = input.visibility;
        if (input.environment !== undefined) patch.environment = input.environment;
        if (input.defaultAccess !== undefined) patch.defaultAccess = input.defaultAccess;
        if (input.requireTls !== undefined) patch.requireTls = input.requireTls;

        // Omitting `url` leaves the stored credential untouched. That is what
        // lets someone rename a connection or flip it out of production without
        // having to paste the password again.
        if (input.url !== undefined) {
          const parsed = parseConnectionUrl(input.url, {
            allowPrivateAddresses: allowsPrivateAddresses(),
          });
          if (parsed.isErr()) {
            throw errors.INVALID_URL({ data: { reason: parsed.error.message } });
          }
          const described = describeConnection(parsed.value);
          patch.encryptedUrl = await encryptForDomain(input.url, "data-connections");
          patch.engine = parsed.value.engine;
          patch.displayHost = described.displayHost;
          patch.displayDatabase = described.displayDatabase;
        }

        context.log.set({ dataConnection: { id: input.id, fields: Object.keys(patch) } });

        const [row] = await db
          .update(dataConnection)
          .set(patch)
          .where(
            and(eq(dataConnection.id, input.id), visibleTo(context.activeOrganizationId, viewerId)),
          )
          .returning(SELECTION);

        if (!row) throw errors.NOT_FOUND();
        // A row flipped to `private` is announced as a DELETE, not an upsert:
        // to everyone else it has genuinely stopped existing, and leaving the
        // old public copy in their collection would be the leak the visibility
        // change was made to prevent.
        if (row.visibility === "org") announce(context.activeOrganizationId, row);
        else publishDeleted(context.activeOrganizationId, row.id);
        return row;
      },
    ),

    deleteConnection: requirePermission({ database: ["write"] }).data.deleteConnection.handler(
      async ({ input, context, errors }) => {
        context.log.set({ dataConnection: { id: input.id, deleted: true } });
        const [row] = await db
          .delete(dataConnection)
          .where(
            and(
              eq(dataConnection.id, input.id),
              visibleTo(context.activeOrganizationId, deps.viewerIdOf(context)),
            ),
          )
          .returning({ id: dataConnection.id });
        if (!row) throw errors.NOT_FOUND();
        publishDeleted(context.activeOrganizationId, row.id);
        return { deleted: true };
      },
    ),

    testConnection: requirePermission({ database: ["read"] }).data.testConnection.handler(
      async ({ input, context, errors }) => {
        context.log.set({ dataConnection: { id: input.id, test: true } });
        const target = await resolveExternalTarget({
          organizationId: context.activeOrganizationId,
          connectionId: input.id,
          viewerId: deps.viewerIdOf(context),
          // A test always opens read-only: it must not be a way to acquire a
          // writable session on a production database.
          mode: "read-only",
        });
        const probe = await probeVersion(target);
        if (probe.isErr()) {
          throw errors.UNREACHABLE({ data: { reason: probe.error.message } });
        }

        await db
          .update(dataConnection)
          .set({ lastConnectedAt: new Date() })
          .where(eq(dataConnection.id, input.id));

        return { ok: true, ...probe.value };
      },
    ),

    testUrl: requirePermission({ database: ["read"] }).data.testUrl.handler(
      async ({ input, context, errors }) => {
        // Deliberately WITHOUT the URL: it carries a live credential, and the
        // log line only needs to say a test happened.
        context.log.set({ dataConnection: { testUrl: true } });
        const parsed = parseConnectionUrl(input.url, {
          allowPrivateAddresses: allowsPrivateAddresses(),
        });
        if (parsed.isErr()) {
          throw errors.INVALID_URL({ data: { reason: parsed.error.message } });
        }
        const probe = await probeVersion(draftTarget(input.url, parsed.value));
        if (probe.isErr()) {
          throw errors.UNREACHABLE({ data: { reason: probe.error.message } });
        }
        return { ok: true, engine: parsed.value.engine, ...probe.value };
      },
    ),
  };
}

export type ConnectionId = DataConnectionId;
