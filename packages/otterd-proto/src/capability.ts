/**
 * Per-request capabilities, mirror of `capability.rs`.
 *
 * The control plane mints and signs these; the node enforces them. The verb
 * table (names, required permissions, monitor allowlist) is the single source
 * both sides read, and is checked against `fixtures/enums.json`.
 */
import * as z from "zod";

import { nonce, sha256Hex, slotRef, u53, wireId } from "./primitives";

export const MAX_CAPABILITY_TTL_MS = 60_000;
export const MAX_CLOCK_UNCERTAINTY_MS = 5_000;

export const PERMISSIONS = [
  "read",
  "mutate",
  "stream-out",
  "stream-in",
  "interactive",
  "install-admin",
  "platform",
] as const;
export const permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permission>;

interface VerbSpec {
  readonly required: readonly Permission[];
  readonly monitor: boolean;
}

const R: VerbSpec = { required: ["read"], monitor: false };
const M: VerbSpec = { required: ["mutate"], monitor: false };
const RO: VerbSpec = { required: ["read", "stream-out"], monitor: false };
const MA: VerbSpec = { required: ["mutate", "install-admin"], monitor: false };

/** Every node verb, in the Rust declaration order. */
export const VERB_TABLE = {
  "workload.apply": M,
  "workload.restart": M,
  "workload.stop": M,
  "workload.remove": M,
  "workload.release-adoption": M,
  "workload.inspect": R,
  "workload.logs": RO,
  "job.run": M,
  "op.status": { required: ["read"], monitor: true },
  "node.details": { required: ["read"], monitor: true },
  "node.health": { required: ["read"], monitor: true },
  "node.units": R,
  "node.reclaim": MA,
  "node.upgrade": { required: ["platform"], monitor: true },
  "node.decommission": { required: ["mutate", "install-admin"], monitor: true },
  "node.reenroll": { required: ["install-admin"], monitor: true },
  "node.retireByBarrier": MA,
  "metrics.sample": { required: ["read"], monitor: true },
  "events.subscribe": RO,
  "health.configure": { required: ["mutate"], monitor: true },
  "container.list": R,
  "container.inspect": R,
  "container.logs": RO,
  "container.exec": { required: ["interactive"], monitor: false },
  "image.pull": M,
  "image.push": M,
  "image.inspect": R,
  "image.list": R,
  "image.remove": M,
  "image.prune": M,
  "network.list": R,
  "network.inspect": R,
  "network.ensure": M,
  "network.connect": M,
  "network.disconnect": M,
  "network.remove": M,
  "volume.list": R,
  "volume.inspect": R,
  "volume.create": M,
  "volume.remove": M,
  "volume.fs": R,
  "volume.export": RO,
  "volume.import": { required: ["mutate", "stream-in"], monitor: false },
  "volume.snapshot": M,
  "volume.clone": M,
  "pool.stats": R,
  "pool.trim": M,
  "pool.grow": MA,
  "backup.run": M,
  "backup.restore": M,
  "backup.status": R,
  "db.connect": { required: ["interactive"], monitor: false },
  "host.shell": { required: ["interactive", "install-admin"], monitor: false },
  "firewall.apply": { required: ["platform"], monitor: false },
  "firewall.cscli": { required: ["platform", "install-admin"], monitor: false },
  "proxy.apply": { required: ["platform"], monitor: false },
  "proxy.status": R,
  "platform.update": { required: ["platform", "install-admin"], monitor: false },
} as const satisfies Record<string, VerbSpec>;

export type Verb = keyof typeof VERB_TABLE;

function isVerb(value: string): value is Verb {
  return Object.hasOwn(VERB_TABLE, value);
}

export const VERBS: readonly Verb[] = Object.keys(VERB_TABLE).filter(isVerb);
export const verb = z.custom<Verb>((v) => typeof v === "string" && isVerb(v), "unknown verb");

export const principalKind = z.enum(["user", "service", "system", "install-admin", "platform"]);
export const principal = z.strictObject({ kind: principalKind, id: z.string() });

export const attemptBinding = z.strictObject({
  slot: slotRef,
  grantId: wireId,
  generation: u53,
  attemptId: wireId.optional(),
});

/** The payload of an `otterd/capability/v1` envelope. */
export const capability = z.strictObject({
  installId: wireId,
  orgId: wireId.optional(),
  principal,
  aud: wireId,
  nodeEpoch: u53,
  authorityTerm: u53,
  verb,
  resourceId: wireId.optional(),
  binding: attemptBinding.optional(),
  pathRoot: z.string().optional(),
  volume: z.string().optional(),
  operationEpoch: u53,
  opId: wireId,
  payloadHash: sha256Hex,
  nonce,
  sessionId: wireId,
  notBeforeUnixMs: u53,
  expiresAtUnixMs: u53,
  maxBytes: u53.optional(),
  permissions: z.array(permission),
});
export type Capability = z.infer<typeof capability>;

/** Refusals reported by the node (`CapabilityError`), tagged by `code`. */
export const capabilityError = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("wrong-install") }),
  z.strictObject({ code: z.literal("wrong-audience") }),
  z.strictObject({ code: z.literal("stale-node-epoch"), got: u53, current: u53 }),
  z.strictObject({ code: z.literal("wrong-session") }),
  z.strictObject({ code: z.literal("wrong-term"), got: u53, current: u53 }),
  z.strictObject({ code: z.literal("revoked-term"), got: u53, below: u53 }),
  z.strictObject({ code: z.literal("clock-unknown") }),
  z.strictObject({ code: z.literal("clock-too-uncertain"), uncertaintyMs: u53 }),
  z.strictObject({ code: z.literal("bad-validity-window"), ttlMs: u53 }),
  z.strictObject({ code: z.literal("not-yet-valid") }),
  z.strictObject({ code: z.literal("expired") }),
  z.strictObject({ code: z.literal("payload-mismatch") }),
  z.strictObject({ code: z.literal("missing-permission"), verb, missing: permission }),
  z.strictObject({ code: z.literal("not-on-monitor"), verb }),
  z.strictObject({ code: z.literal("stale-operation-epoch"), got: u53, highWater: u53 }),
  z.strictObject({ code: z.literal("replayed") }),
  z.strictObject({ code: z.literal("nonce-cache-full") }),
]);
export type CapabilityError = z.infer<typeof capabilityError>;

/** Permissions a capability for `v` must carry. */
export function requiredPermissions(v: Verb): readonly Permission[] {
  return VERB_TABLE[v].required;
}
