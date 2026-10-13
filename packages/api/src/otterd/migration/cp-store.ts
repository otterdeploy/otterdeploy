/**
 * Grant transitions only a migration makes: retiring an adopted grant on the
 * node's `adoption-released` answer (the container is the legacy runtime's
 * again, untouched), and recording that a kept adopted container was deleted.
 */
import { db } from "@otterdeploy/db";
import { otterdGrant, otterdService, otterdServiceRevision } from "@otterdeploy/db/schema/otterd";
import { serviceSpec } from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { and, eq, isNotNull, isNull, not, like } from "drizzle-orm";

import { type StoreFailure, refusal, run, toStoreFailure } from "../store/errors";
import { lockedGrant } from "../store/grants";
import { journal } from "../store/journal";
import { releaseNetwork } from "../store/network";

const GIVEN_BACK = "adoption-released:";

/** The service's current revision and its parsed spec. */
export const currentSpec = (resourceId: string) =>
  run(async (tx) => {
    const [row] = await tx
      .select({ revision: otterdService.revision, spec: otterdServiceRevision.spec })
      .from(otterdService)
      .innerJoin(
        otterdServiceRevision,
        and(
          eq(otterdServiceRevision.resourceId, otterdService.resourceId),
          eq(otterdServiceRevision.revision, otterdService.revision),
        ),
      )
      .where(eq(otterdService.resourceId, resourceId));
    const spec = serviceSpec.safeParse(row?.spec);
    if (!row || !spec.success) throw refusal("unknown-service", `no service ${resourceId}`);
    return { revision: row.revision, spec: spec.data };
  });

/** The node gave the container back: the grant is retired by that answer. */
export function releaseAdoption(
  grantId: string,
  container: string,
  now: number,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    const g = await lockedGrant(tx, grantId);
    if (g.adoptsContainer !== container) {
      throw refusal(
        "not-this-container",
        `${grantId} adopted ${g.adoptsContainer}, not ${container}`,
      );
    }
    if (g.state === "released") return;
    await tx
      .update(otterdGrant)
      .set({ state: "released", releasedAt: now, releaseEvidenceId: `${GIVEN_BACK}${container}` })
      .where(eq(otterdGrant.grantId, grantId));
    await releaseNetwork(tx, g, now);
    await journal(tx, {
      at: now,
      kind: "release",
      resourceId: g.resourceId,
      slotIndex: g.slotIndex,
      nodeId: g.nodeId,
      grantId,
      detail: { by: "adoption-released", container },
    });
  });
}

/** Adopted grants stopped (with a certificate) whose kept container is not yet deleted. */
export const adoptedLeftBehind = () =>
  Result.tryPromise({
    try: () =>
      db
        .select()
        .from(otterdGrant)
        .where(
          and(
            isNotNull(otterdGrant.adoptsContainer),
            eq(otterdGrant.state, "released"),
            isNull(otterdGrant.adoptedRemovedAt),
            not(like(otterdGrant.releaseEvidenceId, `${GIVEN_BACK}%`)),
          ),
        ),
    catch: toStoreFailure,
  });

export const markAdoptedRemoved = (grantId: string, now: number) =>
  run(async (tx) => {
    await tx
      .update(otterdGrant)
      .set({ adoptedRemovedAt: now })
      .where(eq(otterdGrant.grantId, grantId));
    await journal(tx, { at: now, kind: "adopted-container-removed", grantId, detail: {} });
  });

/** A rolled-back resource's otterd service and revisions; its grants stay as history. */
export const forgetService = (resourceId: string) =>
  run(async (tx) => {
    await tx.delete(otterdService).where(eq(otterdService.resourceId, resourceId));
  });
