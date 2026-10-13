/**
 * IPv4 prefix arithmetic for the fleet address plan, the same rules as the
 * node's `otterd-net` crate: a prefix is canonical (no host bits), prefixes
 * either nest or are disjoint, and sub-prefixes are enumerated aligned.
 *
 * Addresses are unsigned 32-bit values held in plain numbers; nothing here
 * uses JavaScript's signed bitwise operators.
 */
import { Result } from "better-result";

export interface Net {
  /** Network address, host bits zero. */
  readonly addr: number;
  readonly len: number;
}

const SPAN = 2 ** 32;

/** Addresses covered by a prefix of this length. */
const sizeOf = (len: number) => 2 ** (32 - len);

export function parseAddr(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function formatAddr(addr: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(addr / 2 ** shift) % 256).join(".");
}

/** The prefix of length `len` that contains `addr`. */
function truncate(addr: number, len: number): Net {
  const l = Math.min(len, 32);
  const size = sizeOf(l);
  return { addr: Math.floor(addr / size) * size, len: l };
}

/** `a.b.c.d/len`, refusing host bits so a typo cannot widen a range. */
export function parseNet(text: string): Result<Net, string> {
  const [a, l, ...rest] = text.split("/");
  const addr = a === undefined ? null : parseAddr(a);
  if (addr === null || l === undefined || rest.length > 0 || !/^\d{1,2}$/.test(l)) {
    return Result.err(`${JSON.stringify(text)} is not an IPv4 prefix (a.b.c.d/len)`);
  }
  const len = Number(l);
  if (len > 32) return Result.err(`prefix length ${len} is above 32`);
  const canonical = truncate(addr, len);
  if (canonical.addr !== addr) {
    return Result.err(`${a}/${len} has host bits set (did you mean ${formatNet(canonical)}?)`);
  }
  return Result.ok(canonical);
}

export const formatNet = (n: Net) => `${formatAddr(n.addr)}/${n.len}`;

export const size = (n: Net) => sizeOf(n.len);

const contains = (n: Net, ip: number) => truncate(ip, n.len).addr === n.addr;

/** Whether `inner` lies entirely inside `outer`. */
export const covers = (outer: Net, inner: Net) =>
  inner.len >= outer.len && contains(outer, inner.addr);

export const overlaps = (a: Net, b: Net) => covers(a, b) || covers(b, a);

export const sameNet = (a: Net, b: Net) => a.addr === b.addr && a.len === b.len;

/** How many aligned sub-prefixes of length `len` the prefix holds. */
export const subnetCount = (n: Net, len: number) =>
  len < n.len || len > 32 ? 0 : 2 ** (len - n.len);

/** The `index`-th aligned sub-prefix of length `len`, if it exists. */
export function subnet(n: Net, len: number, index: number): Net | null {
  if (len < n.len || len > 32 || index >= subnetCount(n, len)) return null;
  const addr = n.addr + index * sizeOf(len);
  return addr < SPAN ? { addr, len } : null;
}

/** The `i`-th host address of the prefix (0 is the network address). */
export const host = (n: Net, i: number): number | null => (i < size(n) ? n.addr + i : null);

/** Prefix order as the node sorts them: by address, then length. */
export const compareNet = (a: Net, b: Net) => a.addr - b.addr || a.len - b.len;
