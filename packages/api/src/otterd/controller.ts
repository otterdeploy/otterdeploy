import { db } from "@otterdeploy/db";
import {
  type Action,
  type GrantView,
  type Signer,
  type Snapshot,
  plan,
} from "@otterdeploy/otterd-cp";
import { type ServiceSpec, serviceSpec } from "@otterdeploy/otterd-proto";
import { log } from "evlog";

/**
 * The scheduler loop: snapshot → `plan()` → apply each action through the
 * store, then talk to nodes. Store transitions are short transactions that
 * re-check the rules; node calls run after them and never inside one.
 *
 * - issue: admit (Prepared), mark Granted, then send `workload.apply`. A
 *   definitive refusal with no side effects is recorded as the grant's
 *   retirement; any other failure or a lost answer asks for a stop, so the
 *   grant is only ever released on evidence.
 * - stop: mark revoked and stopping, send `workload.stop` with a fresh op id
 *   (resent while no certificate has arrived), record the certificate.
 * - fence: revoke the node's grants and record the request in one
 *   transaction, run the node's adapter through `otterd-recover`, record the
 *   evidence or the failure.
 *
 * Issuance runs only while the anchor (when configured) is active at this
 * control plane's term. One controller runs per install.
 */
import type { Hub } from "./hub/hub";
import type { GrantRow } from "./store/rows";
import type { ToolConfig } from "./tools";

import { runFence, sendApply, sendStop, sendUpgrade } from "./node-commands";
import { publishServing } from "./serving";
import { adoptGrant, grantRow } from "./store/adopt";
import { admitGrant, markGrant, markSent, releaseGrant } from "./store/grants";
import { journal } from "./store/journal";
import { setUpgradePhase } from "./store/nodes";
import { markSlotUpdated, recordRollout, revisionOf, setHomeNode } from "./store/services";
import { loadSnapshot } from "./store/snapshot";

export interface ControllerConfig {
  hub: Hub;
  tools: ToolConfig;
  now: () => number;
  /** Is issuance allowed now (anchor active at our term)? */
  mayIssue: () => Promise<boolean>;
  /** Does this process hold the scheduler lock? Only the leader plans and acts. */
  leader: () => Promise<boolean>;
  /** Adopt held attempts; when off, a held grant is stopped and must certify instead. */
  adoption: boolean;
  /** Signs serving sets. */
  signer: Signer;
  installId: string;
  authorityTerm: () => number;
}

const STOP_RETRY_MS = 10_000;
/** A failed fence is retried, never faster than this. */
const FENCE_RETRY_MS = 60_000;

export class Controller {
  private running = false;
  private again = false;
  private readonly inFlight = new Set<string>();
  private readonly lastStop = new Map<string, number>();
  private readonly lastPending = new Map<string, string>();
  private readonly lastFence = new Map<string, number>();
  private leading = false;

  constructor(private readonly cfg: ControllerConfig) {}

  /** Run a pass now, or right after the current one. */
  wake(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    void this.loop();
  }

  private async loop(): Promise<void> {
    this.running = true;
    do {
      this.again = false;
      await this.pass();
    } while (this.again);
    this.running = false;
  }

  private async pass(): Promise<void> {
    const leading = await this.cfg.leader();
    if (leading !== this.leading) {
      this.leading = leading;
      log.warn({
        otterd: { event: leading ? "scheduler leadership taken" : "not the scheduler leader" },
      });
    }
    if (!leading) return;
    const now = this.cfg.now();
    const snap = await loadSnapshot(now);
    if (snap.isErr()) {
      log.error({ otterd: { event: "scheduler snapshot failed", error: snap.error.message } });
      return;
    }
    const issuing = await this.cfg.mayIssue();
    for (const action of plan(snap.value)) await this.apply(action, issuing);
    this.resendStops(snap.value);
    const connected = snap.value.nodes.filter((n) => n.connected).map((n) => n.nodeId);
    await publishServing(this.cfg, connected);
  }

  private async apply(a: Action, issuing: boolean): Promise<void> {
    const now = this.cfg.now();
    switch (a.kind) {
      case "release":
        await releaseGrant(a.grantId, now);
        return;
      case "issue":
        if (issuing) await this.issue(a);
        else
          await this.note(a.resourceId, a.slotIndex, "issuance-suspended", {
            reason: "anchor not active at this term",
          });
        return;
      case "adopt":
        if (this.cfg.adoption && issuing) await this.adopt(a.grantId, a.attemptId);
        else await this.stop(a.grantId, "held attempt not adoptable by this node contract");
        return;
      case "stop":
        await this.stop(a.grantId, a.reason);
        return;
      case "revoke":
      case "orphan":
        await markGrant(a.grantId, a.kind, now, a.reason);
        return;
      case "fence":
        this.fence(a.nodeId, a.reason);
        return;
      case "pending":
        await this.note(a.resourceId, a.slotIndex, a.reason.code, a.reason);
        return;
      case "rollout":
        await recordRollout(a.resourceId, a.outcome, a.revision, now);
        return;
      case "upgrade-phase":
        await this.upgradePhase(a.nodeId, a.phase, now);
        return;
    }
  }

  /** Move a node's upgrade on; entering `upgrading` sends it the signed release. */
  private async upgradePhase(
    nodeId: string,
    phase: "draining" | "upgrading" | "rejoining" | "done",
    now: number,
  ): Promise<void> {
    const set = await setUpgradePhase(nodeId, phase, now);
    if (set.isOk() && phase === "upgrading") {
      this.track(`upgrade:${nodeId}`, () => sendUpgrade(this.cfg, nodeId));
    }
  }

  /** Journal a pending reason when it changes, not on every pass. */
  private async note(
    resourceId: string,
    slotIndex: number,
    code: string,
    detail: object,
  ): Promise<void> {
    const key = `${resourceId}#${slotIndex}`;
    const value = JSON.stringify(detail);
    if (this.lastPending.get(key) === value) return;
    this.lastPending.set(key, value);
    await journal(db, {
      at: this.cfg.now(),
      kind: "pending",
      resourceId,
      slotIndex,
      detail: { code, ...detail },
    });
  }

  private async issue(a: Extract<Action, { kind: "issue" }>): Promise<void> {
    const now = this.cfg.now();
    const admitted = await admitGrant({ ...a, now });
    if (admitted.isErr()) {
      log.warn({
        otterd: { event: "grant not admitted", action: a, refused: admitted.error.message },
      });
      return;
    }
    const svc = await revisionOf(a.resourceId, a.specRevision);
    const spec = svc.isOk() ? serviceSpec.safeParse(svc.value.spec) : null;
    if (spec?.success && spec.data.lifecycle.failover.policy === "stay")
      await setHomeNode(a.resourceId, a.nodeId);
    if (a.reason.startsWith("update to revision")) await markSlotUpdated(a.resourceId, now);
    const sent = await markSent(admitted.value.grantId, now);
    if (sent.isOk() && spec?.success)
      this.track(sent.value.grantId, () => this.sendApply(sent.value, spec.data, null));
  }

  private async adopt(grantId: string, attemptId: string): Promise<void> {
    const now = this.cfg.now();
    const adopted = await adoptGrant(grantId, attemptId, now);
    if (adopted.isErr()) {
      log.warn({ otterd: { event: "adoption refused", grantId, refused: adopted.error.message } });
      return;
    }
    const svc = await revisionOf(adopted.value.resourceId, adopted.value.specRevision);
    const spec = svc.isOk() ? serviceSpec.safeParse(svc.value.spec) : null;
    const sent = await markSent(adopted.value.grantId, now);
    if (sent.isOk() && spec?.success)
      this.track(sent.value.grantId, () => this.sendApply(sent.value, spec.data, attemptId));
  }

  private track(key: string, work: () => Promise<void>): void {
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    void work().finally(() => {
      this.inFlight.delete(key);
      this.wake();
    });
  }

  private async stop(grantId: string, reason: string): Promise<void> {
    const marked = await markGrant(grantId, "stop", this.cfg.now(), reason);
    if (marked.isErr() || marked.value.state === "released") return;
    this.lastStop.set(grantId, this.cfg.now());
    this.track(`stop:${grantId}`, () => this.sendStop(marked.value, reason));
  }

  /** Stops whose certificate has not arrived are sent again while the node can answer. */
  private resendStops(snap: Snapshot): void {
    const now = this.cfg.now();
    const connected = new Set(snap.nodes.filter((n) => n.connected).map((n) => n.nodeId));
    const due = (g: GrantView) =>
      g.stopRequested &&
      connected.has(g.nodeId) &&
      !snap.retirements.some((r) => r.grantId === g.grantId) &&
      now - (this.lastStop.get(g.grantId) ?? 0) >= STOP_RETRY_MS;
    for (const g of snap.grants.filter(due)) {
      this.lastStop.set(g.grantId, now);
      void grantRow(g.grantId).then((row) => {
        const r = row.isOk() ? row.value : null;
        if (r) this.track(`stop:${g.grantId}`, () => this.sendStop(r, "stop not yet certified"));
      });
    }
  }

  private fence(nodeId: string, reason: string): void {
    const now = this.cfg.now();
    if (now - (this.lastFence.get(nodeId) ?? 0) < FENCE_RETRY_MS) return;
    this.lastFence.set(nodeId, now);
    this.track(`fence:${nodeId}`, () => runFence(this.cfg, nodeId, reason));
  }

  private sendApply(g: GrantRow, spec: ServiceSpec, adoptsAttempt: string | null): Promise<void> {
    return sendApply(this.cfg, g, spec, adoptsAttempt, (id, why) => this.stop(id, why));
  }

  private sendStop(g: GrantRow, reason: string): Promise<void> {
    return sendStop(this.cfg, g, reason);
  }
}
