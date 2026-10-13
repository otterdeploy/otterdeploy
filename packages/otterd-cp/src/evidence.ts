/**
 * Positive retirement evidence. Only two things let the control
 * plane release a grant that left it: a node-signed stop certificate that
 * covers every attempt the control plane knows of, or an external barrier
 * (provider power-off observed off, or a recorded manual fence) bound to the
 * grant's node epoch and observed after the grant was issued and revoked. A
 * lease running out, a missing heartbeat, a peer report or an operator
 * checkbox is none of these.
 */
import {
  type SignedEnvelope,
  type SlotRef,
  type StopCertificate,
  barrierEvidence,
  stopCertificate,
  u53,
  verifyAndParse,
} from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import * as z from "zod";

export type BarrierEvidence = z.infer<typeof barrierEvidence>;

export interface EvidenceRefusal {
  code: "signature" | "binding" | "incomplete" | "not-stopped" | "too-early" | "method";
  detail: string;
}

const refuse = (code: EvidenceRefusal["code"], detail: string) =>
  Result.err<never, EvidenceRefusal>({ code, detail });

export interface CertificateExpectation {
  installId: string;
  nodeId: string;
  nodeEpoch: number;
  /** The node's identity key (base64) for this node epoch. */
  identityKey: string;
  grantId: string;
  slot: SlotRef;
  /** Every attempt of the grant seen in any slot report or command answer. */
  knownAttemptIds: readonly string[];
}

/**
 * Verify a node's stop certificate for one grant. It must be signed by that
 * node's identity key, name exactly this install, node, epoch, slot and grant,
 * cover every attempt the control plane knows of, and observe every container
 * positively stopped with empty cgroups.
 */
export function verifyStopCertificate(
  envelope: SignedEnvelope,
  exp: CertificateExpectation,
): Result<StopCertificate, EvidenceRefusal> {
  const parsed = verifyAndParse(
    envelope,
    [exp.identityKey],
    "otterd/stop-certificate/v1",
    stopCertificate,
  );
  if (parsed.isErr()) return refuse("signature", parsed.error.kind);
  const c = parsed.value;
  if (c.installId !== exp.installId || c.nodeId !== exp.nodeId) {
    return refuse("binding", "certificate names another install or node");
  }
  if (c.nodeEpoch !== exp.nodeEpoch) return refuse("binding", "certificate names another epoch");
  if (c.grantId !== exp.grantId) return refuse("binding", "certificate names another grant");
  if (c.slot.resourceId !== exp.slot.resourceId || c.slot.index !== exp.slot.index) {
    return refuse("binding", "certificate names another slot");
  }
  const covered = new Set(c.attemptIds);
  const missing = exp.knownAttemptIds.filter((a) => !covered.has(a));
  if (missing.length > 0) {
    return refuse("incomplete", `attempts not covered: ${missing.join(", ")}`);
  }
  const running = c.containers.filter(
    (o) => !["absent", "created", "exited"].includes(o.process.state),
  );
  if (running.length > 0) {
    return refuse(
      "not-stopped",
      `containers not positively stopped: ${running.map((o) => o.container).join(", ")}`,
    );
  }
  if (!c.cgroupsEmpty) return refuse("not-stopped", "a workload cgroup is populated");
  return Result.ok(c);
}

/** The node-to-machine binding recorded at enrollment (`otterd-fence` `MachineBinding`). */
export const machineBinding = z.object({
  provider: z.string().min(1),
  serverId: z.string().min(1),
  createdAt: z.string().min(1),
  requireLabels: z.record(z.string(), z.string()).optional(),
  machineId: z.string().optional(),
});
export type MachineBinding = z.infer<typeof machineBinding>;

/** The adapter's record of a fence (`otterd-fence` `FenceEvidence`). */
export const fenceEvidence = z.object({
  evidenceId: z.string().min(1),
  method: z.enum(["provider-power-off", "manual-fence"]),
  adapter: z.string().min(1),
  binding: machineBinding,
  requestedAtUnixMs: u53,
  reference: z.string().min(1),
  assertedBy: z.string().optional(),
  observations: z.array(z.object({ atUnixMs: u53, status: z.string() })),
  verifiedOffAtUnixMs: u53,
  detail: z.unknown(),
});
export type FenceEvidence = z.infer<typeof fenceEvidence>;

export interface FenceExpectation {
  nodeEpoch: number;
  binding: MachineBinding;
  /** When revocation of the node's grants was committed; the fence must follow it. */
  revokedAt: number;
}

/**
 * Turn an adapter's fence record into the contract's barrier evidence, after
 * checking it names the bound machine, was requested after the revocation and
 * ended in a verified off state (provider) or a named assertion (manual).
 */
export function acceptFence(
  ev: FenceEvidence,
  exp: FenceExpectation,
): Result<BarrierEvidence, EvidenceRefusal> {
  const b = exp.binding;
  if (
    ev.binding.provider !== b.provider ||
    ev.binding.serverId !== b.serverId ||
    ev.binding.createdAt !== b.createdAt
  ) {
    return refuse("binding", "fence names another machine");
  }
  if (ev.requestedAtUnixMs < exp.revokedAt) {
    return refuse("too-early", "fence requested before the grants were revoked");
  }
  if (ev.verifiedOffAtUnixMs < ev.requestedAtUnixMs) {
    return refuse("incomplete", "off verified before the fence was requested");
  }
  if (ev.method === "provider-power-off") {
    const off = ev.observations.filter(
      (o) => o.status === "off" && o.atUnixMs >= ev.requestedAtUnixMs,
    );
    if (off.length === 0) return refuse("incomplete", "no off observation after the request");
  } else if (!ev.assertedBy) {
    return refuse("method", "a manual fence names who asserted it");
  }
  const barrier = barrierEvidence.safeParse({
    evidenceId: ev.evidenceId,
    method: ev.method,
    adapter: ev.adapter,
    ...(ev.method === "provider-power-off" ? { providerActionId: ev.reference } : {}),
    ...(ev.assertedBy ? { assertedBy: ev.assertedBy } : {}),
    nodeEpoch: exp.nodeEpoch,
    observedAtUnixMs: ev.verifiedOffAtUnixMs,
  });
  if (!barrier.success) return refuse("incomplete", barrier.error.message);
  return Result.ok(barrier.data);
}

/**
 * Does a barrier retire this grant? Same node epoch, and observed after the
 * grant left the control plane and after its revocation was committed.
 */
export function barrierRetires(
  barrier: BarrierEvidence,
  grant: { nodeEpoch: number; sentAt: number | null; revoked: boolean; revokedAt: number | null },
): boolean {
  if (!grant.revoked || grant.revokedAt === null) return false;
  if (barrier.nodeEpoch !== grant.nodeEpoch) return false;
  if (grant.sentAt !== null && barrier.observedAtUnixMs < grant.sentAt) return false;
  return barrier.observedAtUnixMs >= grant.revokedAt;
}
