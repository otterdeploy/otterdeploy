/**
 * Managing external database connections.
 *
 * The URL goes in and never comes out. Every procedure here either stores it
 * (encrypted, under its own secret domain) or reports something derived from
 * it; none returns it, because a workbench that shipped the URL to the browser
 * would hand every viewer a working credential for a database otterdeploy does
 * not run and cannot rotate.
 */
import type { OrganizationId, UserId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { dataConnection } from "@otterdeploy/db/schema";
import { normalizeTags } from "@otterdeploy/shared/data-tags";
import { and, desc, eq, or } from "drizzle-orm";

import { requirePermission } from "../..";
import { describeConnection, parseConnectionUrl, resolveExternalTarget } from "../../data";
import { encryptForDomain } from "../../lib/crypto";
import { publishOrgBusEvent } from "../project/project-event-bus";
import { allowsPrivateAddresses, probeVersion, testUrlHandler } from "./test-probe";

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
  tags: dataConnection.tags,
  createdAt: dataConnection.createdAt,
  lastConnectedAt: dataConnection.lastConnectedAt,
};

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
function publishDeleted(
  organizationId: OrganizationId,
  id: string,
  excludedUserId?: UserId | null,
): void {
  publishOrgBusEvent(organizationId, {
    kind: "data-connections",
    op: "delete",
    keys: [id],
    ...(excludedUserId ? { excludedUserId } : {}),
  });
}

/** The row shape every handler here returns and announces. Never the URL. */
type ConnectionRow = {
  [Key in keyof typeof SELECTION]: (typeof dataConnection.$inferSelect)[Key];
};

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
        const viewerId = deps.viewerIdOf(context);
        if (input.visibility === "private" && viewerId === null) {
          throw errors.DENIED({
            data: { reason: "private connections require an interactive user" },
          });
        }
        const parsed = parseConnectionUrl(input.url, {
          allowPrivateAddresses: allowsPrivateAddresses(),
        });
        if (parsed.isErr()) {
          throw errors.INVALID_URL({ data: { reason: parsed.error.message } });
        }
        const described = describeConnection(parsed.value);
        const tags = normalizeTags(input.tags);
        if (!tags.ok) throw errors.INVALID_TAGS({ data: { reason: tags.reason } });

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
            tags: tags.tags,
            createdBy: viewerId,
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
        if (input.visibility === "private" && viewerId === null) {
          throw errors.DENIED({
            data: { reason: "private connections require an interactive user" },
          });
        }
        const patch: Partial<typeof dataConnection.$inferInsert> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.visibility !== undefined) {
          patch.visibility = input.visibility;
          // The actor making an org row private becomes its owner. Retaining
          // the original creator would make the row disappear for the person
          // who just changed it (and could expose it to a different member).
          if (input.visibility === "private") patch.createdBy = viewerId;
        }
        if (input.environment !== undefined) patch.environment = input.environment;
        if (input.defaultAccess !== undefined) patch.defaultAccess = input.defaultAccess;
        if (input.requireTls !== undefined) patch.requireTls = input.requireTls;
        if (input.tags !== undefined) {
          const tags = normalizeTags(input.tags);
          if (!tags.ok) throw errors.INVALID_TAGS({ data: { reason: tags.reason } });
          patch.tags = tags.tags;
        }

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
        else publishDeleted(context.activeOrganizationId, row.id, viewerId);
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
          .returning({ id: dataConnection.id, visibility: dataConnection.visibility });
        if (!row) throw errors.NOT_FOUND();
        if (row.visibility === "org") publishDeleted(context.activeOrganizationId, row.id);
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

    testUrl: testUrlHandler,
  };
}
