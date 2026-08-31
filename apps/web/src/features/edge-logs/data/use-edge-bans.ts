/**
 * Active CrowdSec bans + the block actions, as the edge-log surfaces need them.
 *
 * A thin adapter over `features/firewall/decisions`, which owns the live
 * decision collection and the three writes. It used to own its own
 * `firewall.decisions` poll and its own block mutations — a second copy of the
 * firewall's, with a second `isPending` and a second toast vocabulary, which is
 * how the two surfaces drifted into disagreeing about whether an address was
 * blocked yet.
 *
 * There is no `blocking` flag any more because the writes are optimistic: the
 * row's marker flips on click and rolls back if the server refuses.
 */
import { blockIps, useBannedIps, useCanBlock } from "@/features/firewall/decisions";

export function useEdgeBans() {
  const canBlock = useCanBlock();
  return {
    bannedIps: useBannedIps(canBlock),
    /** Ban one address for the default 30 days. */
    blockIp: (ip: string) => blockIps([ip]),
    /** Ban a whole sweep in one transaction; the server drops any address
     *  someone is signed in from and reports how many it skipped. */
    blockAll: (ips: readonly string[]) => blockIps(ips),
    /** Callers omit the block affordance entirely when this is false. */
    canBlock,
  };
}
