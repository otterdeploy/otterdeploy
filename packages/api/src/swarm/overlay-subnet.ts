/**
 * The subnet a project's overlay network is created on.
 *
 * Docker keeps two default address pools that know nothing of each other: the
 * daemon's local pool (`default-address-pools` in daemon.json; the installer
 * sets 10.0.0.0/8) for bridges, and the swarm's pool (`--default-addr-pool` at
 * `swarm init`, 10.0.0.0/8 unless given) for overlays. With both on 10.0.0.0/8
 * the swarm hands an overlay a /24 a local bridge already holds, the network is
 * created, and every task on it is refused with "invalid pool request: Pool
 * overlaps with other one on this address space" (moby/moby#50011). The
 * swarm's pool cannot be changed after `swarm init`, so an
 * overlay is given an explicit subnet instead, from a range outside both
 * defaults and free of every network the daemon already knows.
 */

/** Overlay subnets come from here: the one RFC 1918 block outside every
 *  default Docker draws from. Not the installer's local pool or the swarm's
 *  pool (both 10.0.0.0/8), and not Docker's stock local pools (172.17-172.31
 *  as /16s, 192.168.0.0/16 as /20s), which a host without the installer's
 *  daemon.json (a joined worker) still uses. 256 overlays; past that the
 *  swarm allocates, as before. */
export const OVERLAY_SUBNET_BASE = "172.16.0.0/16";
const OVERLAY_SUBNET_SIZE = 24;

interface Range {
  start: number;
  end: number;
}

/** An IPv4 CIDR as a [start, end] address range; null for anything else
 *  (IPv6, malformed). */
export function cidrRange(cidr: string): Range | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  const bits = Number(match[5]);
  if (octets.some((o) => o > 255) || bits > 32) return null;
  const address = octets.reduce((acc, o) => acc * 256 + o, 0);
  const span = 2 ** (32 - bits);
  const start = address - (address % span);
  return { start, end: start + span - 1 };
}

function toCidr(start: number, bits: number): string {
  const octets = [24, 16, 8, 0].map((shift) => Math.floor(start / 2 ** shift) % 256);
  return `${octets.join(".")}/${bits}`;
}

/**
 * The first `/size` subnet inside `base` that overlaps none of `used`, or null
 * when `base` is full (or not a usable IPv4 range). `used` takes every subnet
 * the daemon reports; entries that are not IPv4 CIDRs are ignored.
 */
export function pickOverlaySubnet(
  used: readonly string[],
  base: string = OVERLAY_SUBNET_BASE,
  size: number = OVERLAY_SUBNET_SIZE,
): string | null {
  const range = cidrRange(base);
  if (!range || size > 30) return null;
  const taken = used.map(cidrRange).filter((r): r is Range => r !== null);
  const step = 2 ** (32 - size);
  for (let start = range.start; start + step - 1 <= range.end; start += step) {
    const end = start + step - 1;
    if (!taken.some((t) => t.start <= end && start <= t.end)) return toCidr(start, size);
  }
  return null;
}
