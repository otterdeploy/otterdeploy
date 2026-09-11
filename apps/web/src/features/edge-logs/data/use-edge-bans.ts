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
    /**
     * Ban one address. `hours` undefined takes `blockIps`' default 30 days —
     * there is one list of ban lengths in the app (`BAN_DURATIONS`) and one
     * default, and this is not the place to introduce a second.
     */
    blockIp: (ip: string, hours?: number) => blockIps([ip], hours),
    /** Ban a whole sweep in one transaction; the server drops any address
     *  someone is signed in from and reports how many it skipped. */
    blockAll: (ips: readonly string[], hours?: number) => blockIps(ips, hours),
    /** Callers omit the block affordance entirely when this is false. */
    canBlock,
  };
}
