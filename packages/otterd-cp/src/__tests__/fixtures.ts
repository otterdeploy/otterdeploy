import type * as z from "zod";

import {
  type ServiceSpec,
  normalizeServiceSpec,
  serviceSpecInput,
} from "@otterdeploy/otterd-proto";

import type { GrantView, NodeView, ServiceView, Snapshot } from "../model";

type LifecycleOverrides = z.input<typeof serviceSpecInput>["lifecycle"];

export const GIB = 1024 ** 3;
export const T0 = 1_900_000_000_000;

export function node(id: string, over: Partial<NodeView> = {}): NodeView {
  return {
    nodeId: id,
    nodeEpoch: 1,
    incarnation: `inc-${id}-1`,
    admin: "active",
    roles: ["worker"],
    labels: {},
    arch: "x86_64",
    allocatable: { nanoCpus: 2_000_000_000, memoryBytes: 4 * GIB },
    lastEvidenceAt: T0,
    connected: true,
    reported: true,
    fence: null,
    fencing: false,
    peerFreshUntil: null,
    ordinal: Number(id.replace(/\D/g, "")) || 0,
    upgrade: null,
    ...over,
  };
}

export function spec(
  resourceId: string,
  opts: {
    replicas?: number;
    global?: boolean;
    lifecycle?: LifecycleOverrides;
    update?: z.input<typeof serviceSpecInput>["update"];
    placement?: z.input<typeof serviceSpecInput>["task"]["placement"];
    memoryBytes?: number;
    hostPort?: number;
  } = {},
): ServiceSpec {
  return normalizeServiceSpec(
    serviceSpecInput.parse({
      resourceId,
      mode: opts.global ? { kind: "global" } : { kind: "replicated", replicas: opts.replicas ?? 1 },
      task: {
        container: { image: { reference: "alpine:3.20" } },
        ...(opts.placement ? { placement: opts.placement } : {}),
        ...(opts.memoryBytes
          ? { resources: { reservations: { memoryBytes: opts.memoryBytes } } }
          : {}),
      },
      ...(opts.update ? { update: opts.update } : {}),
      ...(opts.hostPort
        ? {
            endpoint: {
              ports: [{ targetPort: 80, publishedPort: opts.hostPort, publish: "host" }],
            },
          }
        : {}),
      lifecycle: opts.lifecycle ?? {},
    }),
  );
}

export function service(s: ServiceSpec, over: Partial<ServiceView> = {}): ServiceView {
  return {
    resourceId: s.resourceId,
    revision: 1,
    spec: s,
    paused: false,
    stableRevision: 1,
    lastSlotUpdatedAt: null,
    rolloutPaused: false,
    homeNode: null,
    ...over,
  };
}

let grantSeq = 0;
export function grant(
  resourceId: string,
  nodeId: string,
  over: Partial<GrantView> = {},
): GrantView {
  grantSeq++;
  return {
    grantId: `g${grantSeq}`,
    resourceId,
    slotIndex: 0,
    generation: 1,
    nodeId,
    nodeEpoch: 1,
    incarnation: `inc-${nodeId}-1`,
    exclusive: false,
    specRevision: 1,
    state: "running",
    orphan: false,
    surge: false,
    revoked: false,
    stopRequested: false,
    sentAt: T0 - 60_000,
    runningSince: T0 - 60_000,
    failed: false,
    held: null,
    ...over,
  };
}

export function snapshot(over: Partial<Snapshot>): Snapshot {
  return { now: T0, nodes: [], services: [], grants: [], retirements: [], ...over };
}

/** Node `id` last heard from `ago` ms before `now`, session gone. */
export function silent(
  id: string,
  now: number,
  ago: number,
  over: Partial<NodeView> = {},
): NodeView {
  return node(id, { connected: false, incarnation: null, lastEvidenceAt: now - ago, ...over });
}
