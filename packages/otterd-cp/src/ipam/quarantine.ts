/**
 * The no-reuse rules. An address a peer may still forward to (an endpoint,
 * a scope network, a removed node's slice) returns to the free pool only
 * after every forwarding peer has acknowledged cleanup or has been fenced
 * from forwarding until it rejoins. Time alone never frees anything. Stable
 * service addresses are never reused at all.
 */
import { Result } from "better-result";

import type { AddressPlan, Held } from "./state";

import { formatAddr, formatNet, host, size } from "./addr";
import { type IpamError, ipamError } from "./errors";

/** Holds `held` for the peers; null when no peer can forward (free at once). */
export function hold(p: AddressPlan, held: Held, awaiting: ReadonlySet<string>): number | null {
  if (awaiting.size === 0) return null;
  const id = p.nextQuarantine;
  p.nextQuarantine += 1;
  p.quarantine.push({ id, held, awaiting: new Set(awaiting) });
  return id;
}

/** A peer reports cleanup done for one entry; true once the entry is released. */
export function acknowledge(p: AddressPlan, id: number, peer: string): Result<boolean, IpamError> {
  const entry = p.quarantine.find((q) => q.id === id);
  if (!entry) return Result.err(ipamError.unknownQuarantine(id));
  entry.awaiting.delete(peer);
  const done = entry.awaiting.size === 0;
  if (done) p.quarantine = p.quarantine.filter((q) => q.id !== id);
  return Result.ok(done);
}

/**
 * A peer is verifiably fenced from forwarding until it rejoins with current
 * state (a control-plane flag is not enough). It no longer holds back any
 * entry. Returns the ids this released.
 */
export function peerFenced(p: AddressPlan, peer: string): number[] {
  const released: number[] = [];
  for (const q of p.quarantine) {
    q.awaiting.delete(peer);
    if (q.awaiting.size === 0) released.push(q.id);
  }
  p.quarantine = p.quarantine.filter((q) => q.awaiting.size > 0);
  return released;
}

/** The next stable service address. VIPs only move forward. */
export function allocateVip(p: AddressPlan, vip: string): Result<number, IpamError> {
  const existing = p.vips.get(vip);
  if (existing !== undefined) return Result.err(ipamError.vipExists(vip, formatAddr(existing)));
  const range = p.layout.vip;
  const addr = p.nextVip < size(range) - 1 ? host(range, p.nextVip) : null;
  if (addr === null) return Result.err(ipamError.vipExhausted(formatNet(range)));
  p.nextVip += 1;
  p.vips.set(vip, addr);
  return Result.ok(addr);
}

/** Deletes a VIP. Its address is retired, not freed. */
export function retireVip(p: AddressPlan, vip: string): number | null {
  const addr = p.vips.get(vip);
  p.vips.delete(vip);
  return addr ?? null;
}
