/**
 * Does this ban target cover this address?
 *
 * A firewall decision's target is an IP *or* a CIDR, so "is my own address in
 * the blast radius" is a containment question, not an equality one. Comparing
 * strings would have let `172.71.0.0/16` sail past a guard watching for the
 * operator's exact `172.71.4.9`, which is the case the guard exists for: the
 * range block is the one that locks people out, not the single-host one.
 *
 * Built on `node:net`'s BlockList, the same primitive the trusted-proxy gate
 * uses, so subnet arithmetic is the platform's job rather than ours.
 */
import { BlockList, isIP } from "node:net";

type Family = "ipv4" | "ipv6";

function familyOf(address: string): Family | null {
  const version = isIP(address);
  if (version === 4) return "ipv4";
  if (version === 6) return "ipv6";
  return null;
}

/**
 * A predicate for "is `ip` inside `target`", or null when `target` is not an
 * address or CIDR at all.
 *
 * Null rather than a never-matching predicate on purpose: a caller that cannot
 * tell "nothing matched" from "I could not read the target" would treat an
 * unparseable ban as safe, and unparseable is exactly when it isn't known to
 * be. Callers decide what to do with that; the block handlers refuse.
 */
export function ipMatcher(target: string): ((ip: string) => boolean) | null {
  const trimmed = target.trim();
  const slash = trimmed.indexOf("/");
  const list = new BlockList();

  if (slash === -1) {
    const family = familyOf(trimmed);
    if (!family) return null;
    list.addAddress(trimmed, family);
  } else {
    const base = trimmed.slice(0, slash);
    const prefix = Number(trimmed.slice(slash + 1));
    const family = familyOf(base);
    if (!family || !Number.isInteger(prefix)) return null;
    if (prefix < 0 || prefix > (family === "ipv4" ? 32 : 128)) return null;
    list.addSubnet(base, prefix, family);
  }

  return (ip: string) => {
    const family = familyOf(ip);
    return family !== null && list.check(ip, family);
  };
}

/** Every address in `candidates` that `target` would also block. Empty when
 *  `target` is unparseable — callers that must fail closed check that first
 *  with {@link ipMatcher}. */
export function coveredBy(target: string, candidates: Iterable<string>): string[] {
  const matches = ipMatcher(target);
  if (!matches) return [];
  const hit: string[] = [];
  for (const candidate of candidates) {
    if (matches(candidate)) hit.push(candidate);
  }
  return hit;
}
