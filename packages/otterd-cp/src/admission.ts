/**
 * The two rules every grant transition obeys, as pure functions over one
 * slot's rows. The store calls them inside the transaction that holds the
 * slot's row lock; Postgres additionally enforces I1 with a partial unique
 * index, so a bug here cannot produce a second live exclusive grant.
 *
 * - **Admit (I1, I2, I5):** an exclusive slot admits a new generation only
 *   when it has no grant that is not Released, Unknown and Stopping included.
 *   A shared slot admits one active grant plus one start-first surge; orphan-
 *   possible copies do not count as active but keep their reservation.
 *   Every admission takes the slot's generation high-water plus one.
 * - **Release:** a grant that never left the control plane
 *   (Prepared) can be cancelled; any other needs positive retirement evidence
 *   bound to it. Timeouts, silence and lease expiry never release.
 */
import { Result } from "better-result";

import type { GrantView, Retirement } from "./model";

export interface SlotRows {
  /** Highest generation ever admitted to the slot (durable, monotonic). */
  highWater: number;
  /** Every grant of the slot that is not Released. */
  grants: readonly GrantView[];
}

export type AdmissionRefusal =
  | { code: "exclusive-slot-held"; grantIds: string[] }
  | { code: "slot-occupied"; grantIds: string[] }
  | { code: "surge-without-incumbent" };

export interface AdmitRequest {
  exclusive: boolean;
  /** Start-first candidate beside one active incumbent (shared only). */
  surge: boolean;
}

export function admit(slot: SlotRows, req: AdmitRequest): Result<number, AdmissionRefusal> {
  const live = slot.grants.filter((g) => g.state !== "released");
  if (req.exclusive || live.some((g) => g.exclusive)) {
    if (live.length > 0) {
      return Result.err({ code: "exclusive-slot-held", grantIds: live.map((g) => g.grantId) });
    }
    return Result.ok(slot.highWater + 1);
  }
  const active = live.filter((g) => !g.orphan && !g.surge);
  const surges = live.filter((g) => !g.orphan && g.surge);
  if (req.surge) {
    if (active.length !== 1) return Result.err({ code: "surge-without-incumbent" });
    if (surges.length > 0) {
      return Result.err({ code: "slot-occupied", grantIds: surges.map((g) => g.grantId) });
    }
  } else if (active.length + surges.length > 0) {
    return Result.err({
      code: "slot-occupied",
      grantIds: [...active, ...surges].map((g) => g.grantId),
    });
  }
  return Result.ok(slot.highWater + 1);
}

export type ReleaseRefusal =
  | { code: "already-released" }
  | { code: "no-evidence"; state: GrantView["state"] }
  | { code: "evidence-for-another-grant"; evidenceGrantId: string };

/**
 * May this grant become Released? `retirement` is evidence the store has
 * verified for exactly this grant; `null` is allowed only for a Prepared grant
 * that never left the control plane.
 */
export function mayRelease(
  grant: GrantView,
  retirement: Retirement | null,
): Result<"cancel" | "evidence", ReleaseRefusal> {
  if (grant.state === "released") return Result.err({ code: "already-released" });
  if (retirement === null) {
    if (grant.state === "prepared" && grant.sentAt === null) return Result.ok("cancel");
    return Result.err({ code: "no-evidence", state: grant.state });
  }
  if (retirement.grantId !== grant.grantId) {
    return Result.err({ code: "evidence-for-another-grant", evidenceGrantId: retirement.grantId });
  }
  return Result.ok("evidence");
}
