/**
 * The two flags that decide whether a backup may be written to a destination.
 *
 * They answer different questions and are deliberately separate. `status` is
 * operator intent about a destination that IS one — "pause this bucket".
 * `usedForBackups` asks whether the row is a backup destination at all: the
 * same table stores buckets connected in the workbench purely to browse, and
 * connecting one is not consent to write backups into it.
 *
 * They share one rule, which is why they share `flipGuarded`: turning either
 * one OFF may never leave the org with nothing a backup can be written to,
 * because every schedule would then quietly write nowhere. Turning either ON
 * is always allowed.
 *
 * Split from `destination-service.ts` to keep that file under the max-lines cap.
 */
import type { BackupDestinationId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import type { OrgRef } from "../scopes";
import type { DestinationView } from "./queries";
import type { DestinationResult } from "./service";

import { canDisableManagedDestination } from "../../backups/managed-destination";
import { DestinationLastActiveError, DestinationNotFoundError } from "./errors";
import {
  getDestinationGuardFields,
  setDestinationStatusRecord,
  setDestinationUsedForBackupsRecord,
} from "./queries";

type FlagResult = Result<DestinationResult, DestinationNotFoundError | DestinationLastActiveError>;

/**
 * Flip one flag, refusing to switch off the org's last usable destination.
 *
 * `write` is the only thing the two callers differ by; everything around it —
 * the existence check, the peer guard, the not-found-after-write case — is the
 * same rule stated once.
 */
async function flipGuarded(
  input: OrgRef & {
    id: BackupDestinationId;
    /** Turning it ON is free; only OFF needs a surviving peer. */
    on: boolean;
    write: () => Promise<DestinationView | null>;
  },
): Promise<FlagResult> {
  const guard = await getDestinationGuardFields({
    organizationId: input.organizationId,
    id: input.id,
  });
  if (!guard) {
    return Result.err(new DestinationNotFoundError({ destinationId: input.id }));
  }
  if (!input.on) {
    const hasPeer = await canDisableManagedDestination({
      organizationId: input.organizationId,
      id: input.id,
    });
    if (!hasPeer) {
      return Result.err(new DestinationLastActiveError({ destinationId: input.id }));
    }
  }
  const row = await input.write();
  if (!row) {
    return Result.err(new DestinationNotFoundError({ destinationId: input.id }));
  }
  return Result.ok({ ...row, usedBytes: 0 });
}

/**
 * Enable or disable a destination. Disabling is operator intent: the scheduler
 * skips it on future runs while its existing snapshots stay restorable.
 *
 * The guard applies to every destination, not just the managed one: disabling
 * the last active S3 bucket is just as silent a failure as disabling the last
 * local one.
 */
export async function setDestinationEnabled(
  input: OrgRef & { id: BackupDestinationId; enabled: boolean },
): Promise<FlagResult> {
  return flipGuarded({
    organizationId: input.organizationId,
    id: input.id,
    on: input.enabled,
    write: () =>
      setDestinationStatusRecord({
        organizationId: input.organizationId,
        id: input.id,
        status: input.enabled ? "active" : "disabled",
      }),
  });
}

/**
 * Opt a destination into, or out of, being written to by the scheduler.
 *
 * Opting IN is the explicit act this flag exists for: it is what turns a
 * bucket someone connected to browse into a place backups are written.
 */
export async function setDestinationUsedForBackups(
  input: OrgRef & { id: BackupDestinationId; usedForBackups: boolean },
): Promise<FlagResult> {
  return flipGuarded({
    organizationId: input.organizationId,
    id: input.id,
    on: input.usedForBackups,
    write: () =>
      setDestinationUsedForBackupsRecord({
        organizationId: input.organizationId,
        id: input.id,
        usedForBackups: input.usedForBackups,
      }),
  });
}
