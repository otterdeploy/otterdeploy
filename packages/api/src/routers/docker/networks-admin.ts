/**
 * Operator network creation — the write half of the Raw Docker networks tab.
 * Split out of service-admin.ts (line cap); the read/remove paths stay there.
 */
import type { NetworkCreateOptions } from "@otterdeploy/docker";

import { PLATFORM } from "../../constants";
import { docker, failure, type Listed } from "./client";
import { guardNetworkCreateName } from "./guards";

/** Marks a network as created by an operator through the panel — the
 *  per-service extra-networks picker keys its eligibility off this. */
export const USER_NETWORK_LABEL = "otterdeploy.user-network";

export interface CreateNetworkInput {
  name: string;
  driver: "bridge" | "overlay";
  internal?: boolean;
  attachable?: boolean;
  enableIPv6?: boolean;
  mtu?: number;
  ipam?: Array<{ subnet?: string; gateway?: string; ipRange?: string }>;
  labels?: Record<string, string>;
}

function toCreateOptions(input: CreateNetworkInput): NetworkCreateOptions {
  const ipamPools = (input.ipam ?? []).filter((p) => p.subnet || p.gateway || p.ipRange);
  return {
    Name: input.name,
    Driver: input.driver,
    Internal: input.internal ?? false,
    // Attachable defaults ON — an unattachable network can't serve the
    // per-service attach feature (and standalone-container debugging) at all.
    Attachable: input.attachable ?? true,
    EnableIPv6: input.enableIPv6 ?? false,
    ...(ipamPools.length > 0
      ? {
          IPAM: {
            Driver: "default",
            Config: ipamPools.map((p) => ({
              ...(p.subnet ? { Subnet: p.subnet } : {}),
              ...(p.ipRange ? { IPRange: p.ipRange } : {}),
              ...(p.gateway ? { Gateway: p.gateway } : {}),
            })),
          },
        }
      : {}),
    ...(input.mtu !== undefined
      ? { Options: { "com.docker.network.driver.mtu": String(input.mtu) } }
      : {}),
    Labels: { ...input.labels, [USER_NETWORK_LABEL]: "true" },
  };
}

export async function createNetwork(
  input: CreateNetworkInput,
): Promise<Listed<{ id: string; name: string; warning: string | null }>> {
  const guard = guardNetworkCreateName({
    name: input.name,
    managedPrefix: PLATFORM.swarm.networkPrefix,
  });
  if (!guard.ok) return { ok: false, reason: guard.reason, kind: "conflict" };

  // Unlike volume create, network create is NOT idempotent — but docker allows
  // duplicate network NAMES (identity is the id). Pre-inspect so the operator
  // gets an honest 409 instead of a second network shadowing the first.
  const existing = await docker.networks.inspect(input.name);
  if (existing.isOk()) {
    return {
      ok: false,
      reason: `Network ${input.name} already exists`,
      kind: "conflict",
    };
  }

  const created = await docker.networks.create(toCreateOptions(input));
  if (created.isErr()) return failure(created.error);
  return {
    ok: true,
    items: {
      id: created.value.Id,
      name: input.name,
      warning: created.value.Warning ? created.value.Warning : null,
    },
  };
}
