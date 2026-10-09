/**
 * Session procedures: the explicit connect and disconnect.
 *
 * `openSession` is the only call that starts a tunnel, and it proves the
 * tunnel with one round trip before answering, so the client's "connecting…"
 * ends in either a version string or the real reason. A session that fails
 * its probe is closed on the spot: a dead tunnel must never sit in the
 * registry looking live.
 */
import type { OrganizationId, ResourceId, UserId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource, project, resource } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { and, eq } from "drizzle-orm";

import { requirePermission } from "../..";
import { closeSession, listSessions, openSession, ownerOf, sessionKey } from "../../data";
import { toDataError } from "../../data/errors";
import { guardTarget, raise, resolveTarget, targetLog } from "./plumbing";
import { probeVersion } from "./test-probe";

/** Is `resourceId` a managed database in this organization? */
async function isOrgDatabase(
  organizationId: OrganizationId,
  resourceId: ResourceId,
): Promise<boolean> {
  const [row] = await db
    .select({ id: databaseResource.resourceId })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(eq(databaseResource.resourceId, resourceId), eq(project.organizationId, organizationId)),
    )
    .limit(1);
  return row !== undefined;
}

export function makeSessionHandlers(deps: {
  viewerIdOf: (context: { session?: { user?: { id?: string } } | null }) => UserId | null;
}) {
  return {
    openSession: requirePermission({ database: ["read"] }).data.openSession.handler(
      async ({ input, context, errors }) => {
        context.log.set({ ...targetLog(input.target), dataSession: { open: true } });
        await guardTarget(context, input.target);
        // A managed target must be a database of the caller's organization
        // before the session locates its container: that lookup is by resource
        // id alone, and the scope guard above leaves the NOT_FOUND answer for
        // an unknown id to this handler.
        if (
          input.target.kind === "resource" &&
          !(await isOrgDatabase(context.activeOrganizationId, input.target.resourceId))
        ) {
          throw errors.NOT_FOUND();
        }
        const opened = await openSession({
          owner: ownerOf(deps.viewerIdOf(context)),
          organizationId: context.activeOrganizationId,
          target: input.target,
        });
        if (opened.isErr()) throw raise(opened.error, errors);
        const session = opened.value;

        // Prove the path before reporting it open. Read-only: opening a
        // session must not be a way to acquire a writable connection.
        const target = await Result.tryPromise({
          try: () => resolveTarget(context, input.target, "read-only"),
          catch: toDataError,
        });
        if (target.isErr()) {
          closeSession(session.key);
          throw raise(target.error, errors);
        }
        const probe = await probeVersion(target.value);
        if (probe.isErr()) {
          const relay = session.tunnel?.lastRelayError() ?? null;
          closeSession(session.key);
          throw errors.UNREACHABLE({
            data: {
              reason:
                relay === null ? probe.error.message : `${probe.error.message} (relay: ${relay})`,
            },
          });
        }
        return { key: session.key, tunneled: session.tunnel !== null, ...probe.value };
      },
    ),

    closeSession: requirePermission({ database: ["read"] }).data.closeSession.handler(
      async ({ input, context }) => {
        context.log.set({ ...targetLog(input.target), dataSession: { close: true } });
        const key = sessionKey({
          owner: ownerOf(deps.viewerIdOf(context)),
          organizationId: context.activeOrganizationId,
          target: input.target,
        });
        return { closed: closeSession(key) };
      },
    ),

    listSessions: requirePermission({ database: ["read"] }).data.listSessions.handler(
      async ({ context }) => {
        const now = Date.now();
        const sessions = listSessions(
          ownerOf(deps.viewerIdOf(context)),
          context.activeOrganizationId,
        ).map((s) => ({
          key: s.key,
          target: s.target,
          tunneled: s.tunnel !== null,
          openedAt: s.openedAt,
          idleMs: now - s.lastUsedAt,
        }));
        return { sessions };
      },
    ),
  };
}
