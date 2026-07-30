/**
 * Preview branches that depend on a base database.
 *
 * Deleting a database that still has live branches is refused, and the refusal
 * is a PRECONDITION rather than a failure handler. That placement is
 * load-bearing: `resource-delete.ts` strips the database from the manifest
 * FIRST, on purpose, so a partial teardown diffs as a recoverable delete rather
 * than a phantom create. If the destroy is instead allowed to fail partway, the
 * manifest entry is already gone while the data is still on disk — the worst of
 * both.
 *
 * Under the `copy` strategy a branch is an independent volume, so the base
 * could technically be destroyed; the branch would simply be left pointing at a
 * `branchedFromResourceId` that resolves to nothing. Under `zfs` it is stronger
 * than a preference: a clone pins its origin snapshot, and ZFS refuses to
 * destroy a dataset while a clone depends on it. The guard is therefore
 * strategy-independent — one rule, and the ZFS case cannot be forgotten.
 *
 * The message names the pull requests, because a filesystem error about
 * dependent clones is unactionable: nothing in the UI connects a dataset to
 * someone's open PR. "3 preview branches depend on this database: PR 128, PR
 * 131, PR 140 (pinned)" is an instruction.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { preview, resource } from "@otterdeploy/db/schema/project";
import { and, eq, isNotNull } from "drizzle-orm";

export interface BranchDependent {
  prNumber: number;
  /** A pinned preview (`auto_teardown_at` NULL) never expires on its own, so
   *  waiting is not a valid resolution for it. */
  pinned: boolean;
}

/** Live preview branches whose source is this database. */
async function branchDependentsOf(baseResourceId: ResourceId): Promise<BranchDependent[]> {
  const rows = await db
    .select({ prNumber: preview.prNumber, autoTeardownAt: preview.autoTeardownAt })
    .from(resource)
    .innerJoin(preview, eq(preview.id, resource.previewId))
    .where(
      and(
        eq(resource.branchedFromResourceId, baseResourceId),
        isNotNull(resource.previewId),
        // Closed previews have been torn down; their rows are on the way out
        // and must not block a delete.
        eq(preview.state, "active"),
      ),
    );
  return rows
    .map((r) => ({ prNumber: r.prNumber, pinned: r.autoTeardownAt === null }))
    .sort((a, b) => a.prNumber - b.prNumber);
}

/**
 * Why this database cannot be deleted yet, or null when it can.
 *
 * Pinned previews are called out separately because the resolution differs: an
 * ordinary preview is reaped at `auto_teardown_at`, so waiting works and the
 * block clears itself. A pinned one never expires — it needs a person.
 */
export function branchDependentsMessage(dependents: BranchDependent[]): string | null {
  if (dependents.length === 0) return null;

  const label = (d: BranchDependent) => `PR ${d.prNumber}${d.pinned ? " (pinned)" : ""}`;
  const list = dependents.map(label).join(", ");
  const noun = dependents.length === 1 ? "preview branch depends" : "preview branches depend";
  const base = `${dependents.length} ${noun} on this database: ${list}.`;

  return dependents.some((d) => d.pinned)
    ? `${base} Close those pull requests, or unpin the pinned ones — a pinned preview is never torn down automatically.`
    : `${base} Close those pull requests, or wait for the previews to be torn down.`;
}

/** Convenience: the check as one call. */
export async function branchDependencyConflict(baseResourceId: ResourceId): Promise<string | null> {
  return branchDependentsMessage(await branchDependentsOf(baseResourceId));
}
