/**
 * What the scheduler takes from the address plan for one grant: the node's
 * slice and the scope's network there on first use, then one attempt
 * address. The address goes back through the quarantine when the grant's
 * stop is acknowledged.
 */
import { Result } from "better-result";

import type { AddressPlan } from "./state";

import { type Net, host, size } from "./addr";
import { type IpamError } from "./errors";
import { enrollNode } from "./nodes";
import { acknowledge } from "./quarantine";
import { allocateEndpoint, allocateScope } from "./scopes";

/** A scope's network on one node: a /27 unit, 29 attempt addresses. */
const SCOPE_LEN = 27;

export interface AttemptPlace {
  subnet: Net;
  address: number;
}

export function placeAttempt(
  p: AddressPlan,
  scopeId: string,
  nodeId: string,
): Result<AttemptPlace, IpamError> {
  return Result.gen(function* () {
    if (!p.nodes.has(nodeId)) yield* enrollNode(p, nodeId);
    const subnet =
      p.scopes.get(scopeId)?.get(nodeId) ?? (yield* allocateScope(p, scopeId, nodeId, SCOPE_LEN));
    const address = yield* allocateEndpoint(p, scopeId, nodeId);
    return Result.ok({ subnet, address });
  });
}

/**
 * A peer's acknowledgement that it no longer forwards to a released attempt
 * address. True once the address is free again; null when nothing holds it.
 */
export function acknowledgeAddress(
  p: AddressPlan,
  address: number,
  peer: string,
): Result<boolean, IpamError> | null {
  const entry = p.quarantine.find((q) => q.held.kind === "endpoint" && q.held.addr === address);
  return entry ? acknowledge(p, entry.id, peer) : null;
}

/** The `index`-th environment resolver listener address (1-based); null when the range is used up. */
export const resolverAddress = (p: AddressPlan, index: number): number | null =>
  index >= 1 && index < size(p.layout.dns) - 1 ? host(p.layout.dns, index) : null;
