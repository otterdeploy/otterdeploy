/**
 * The platform-managed local backup destination.
 *
 * Every org gets exactly one, created on demand. Without it a fresh install has
 * zero destinations, and since `backupCreateScheduleInput` requires
 * `destinationIds.min(1)` nobody can schedule a backup until they hand-configure
 * a destination: including inventing a host path for `local`, which the
 * operator has no reason to choose and no way to validate. The platform knows
 * the right answer (`DATA_ROOT`), so it owns this one.
 *
 * What "managed" buys the user:
 *   - it always exists, so the schedule form has a destination pre-selected;
 *   - its path is ours, so it cannot point somewhere unwritable or off-volume;
 *   - it cannot be deleted, so an org can never fall back to zero destinations.
 * It CAN be disabled once another active destination exists: see
 * `canDisableManagedDestination`: for operators who don't want local copies
 * consuming the data volume.
 *
 * IMPORTANT: a local destination is not disaster recovery. It sits on the same
 * host as the data it protects, and under swarm it is node-local: losing that
 * node loses both the database and its backups. It is a fast rollback/restore
 * copy. Callers that present it MUST say so rather than implying the org is
 * safely backed up (PRODUCT.md: honest-about-system-state).
 */
import type { BackupDestinationId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backupDestination } from "@otterdeploy/db/schema";
import { orgBackupRepoRoot } from "@otterdeploy/shared/paths";
import { and, eq, ne, or } from "drizzle-orm";

/** Shown in the destinations list and pre-selected in the schedule form. The
 *  name is the one field the operator may edit, so this is only the initial
 *  value: never match on it, match on `managed`. */
const MANAGED_LOCAL_DESTINATION_NAME = "Local disk (managed)";

/**
 * The config the platform owns for the managed row. `path` IS the org's repo
 * root (`orgs/<org>/backups/`), so the org namespace lives in the path itself -
 * one org's `forget --prune` can never reach another's snapshots: and
 * `deriveRepoKey` uses the bare scope as the managed repo id (no prefix key),
 * with an org-qualified password domain.
 */
export function managedLocalConfig(organizationId: OrganizationId): { path: string } {
  return { path: orgBackupRepoRoot(organizationId) };
}

/**
 * Ensure the org's managed local destination exists, and return its id.
 *
 * Idempotent and concurrency-safe: the insert is guarded by the partial unique
 * index `backup_destination_managed_org_idx` (one managed row per org), so two
 * simultaneous callers cannot both create one: the loser's
 * `onConflictDoNothing` returns no row and we fall through to the read.
 *
 * Also self-heals `config`: if DATA_ROOT moved (a redeployed install with a
 * different `OTTERDEPLOY_DATA_DIR`) the stored path would otherwise keep
 * pointing at a directory that no longer exists. Existing snapshots under the
 * old root are not migrated: this only makes NEW backups land somewhere real.
 */
export async function ensureManagedLocalDestination(organizationId: OrganizationId): Promise<void> {
  const desiredConfig = managedLocalConfig(organizationId);

  const [inserted] = await db
    .insert(backupDestination)
    .values({
      organizationId,
      name: MANAGED_LOCAL_DESTINATION_NAME,
      type: "local",
      config: desiredConfig,
      encryptedSecret: null,
      managed: true,
    })
    .onConflictDoNothing()
    .returning({ id: backupDestination.id });
  if (inserted) return;

  // Already present (or another caller just won the race). Reconcile the
  // platform-owned config only: never the name, which the operator may edit.
  const [existing] = await db
    .select({ id: backupDestination.id, config: backupDestination.config })
    .from(backupDestination)
    .where(
      and(
        eq(backupDestination.organizationId, organizationId),
        eq(backupDestination.managed, true),
      ),
    )
    .limit(1);
  if (!existing) return;

  if (existing.config.path === desiredConfig.path) return;

  // The platform owns the managed row's whole config, so replace it outright -
  // merging would carry stale platform keys forward.
  await db
    .update(backupDestination)
    .set({ config: desiredConfig })
    .where(eq(backupDestination.id, existing.id));
}

/**
 * May the managed destination be disabled right now?
 *
 * Only while some OTHER destination is still active: disabling the last active
 * destination would silently turn every schedule into a no-op, which is exactly
 * the "configured but not actually backing up" state this whole feature exists
 * to remove. A `degraded` peer counts: it is a health signal, not operator
 * intent, and the scheduler still fans out to it.
 */
export async function canDisableManagedDestination(input: {
  organizationId: OrganizationId;
  id: BackupDestinationId;
}): Promise<boolean> {
  const [peer] = await db
    .select({ id: backupDestination.id })
    .from(backupDestination)
    .where(
      and(
        eq(backupDestination.organizationId, input.organizationId),
        ne(backupDestination.id, input.id),
        or(eq(backupDestination.status, "active"), eq(backupDestination.status, "degraded")),
      ),
    )
    .limit(1);
  return Boolean(peer);
}
