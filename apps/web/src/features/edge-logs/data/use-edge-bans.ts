/**
 * Active CrowdSec bans + the block actions, shared plumbing for the edge-log
 * and firewall surfaces. Exposes the set of currently-banned client IPs (so
 * rows can carry a "blocked" marker and block buttons stay honest) and the
 * single/bulk block mutations, refreshing the set after every successful block.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

export function useEdgeBans(onBlocked?: () => void) {
  // The whole CrowdSec surface is install-scoped. `firewall.decisions` is
  // `requireInstallAdmin()` and block/blockMany are `requireInstallAdminPermission`.
  // The edge-log planes that use this are NOT admin-only, so without this the
  // ban poll 403s every 30s for an ordinary member while the block buttons it
  // feeds would 403 on click. Callers read `canBlock` and omit the affordance.
  const canBlock = useRouteContext({ from: "/_app", select: (c) => c.isInstallAdmin });

  const decisions = useQuery({
    ...orpc.firewall.decisions.queryOptions(),
    refetchInterval: 30_000,
    enabled: canBlock,
  });
  const bannedIps = new Set(
    (decisions.data ?? []).flatMap((d) => (d.scope.toLowerCase() === "ip" ? [d.value] : [])),
  );

  const settled = () => {
    void decisions.refetch();
    onBlocked?.();
  };
  const block = useMutation({
    ...orpc.firewall.block.mutationOptions(),
    onSuccess: (r, vars) => {
      if (r.ok) {
        toast.success(`Blocked ${vars.ip} at the edge`);
        settled();
      } else {
        toast.error(r.error ?? "Block failed");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Block failed"),
  });
  const blockMany = useMutation({
    ...orpc.firewall.blockMany.mutationOptions(),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error ?? "Block failed");
        return;
      }
      // The server drops any target someone is signed in from before it bans
      // anything (routers/firewall/self-block-guard). Say so: a sweep that
      // quietly blocks fewer addresses than the button offered looks like it
      // lost them.
      const skipped =
        r.skipped > 0
          ? `${r.skipped} skipped — someone is signed in from ${r.skipped === 1 ? "it" : "them"}`
          : undefined;
      if (r.blocked === 0) {
        toast.info("Nothing was blocked", { description: skipped });
      } else {
        toast.success(`Blocked ${r.blocked} IP${r.blocked === 1 ? "" : "s"} at the edge`, {
          description: skipped,
        });
      }
      settled();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Block failed"),
  });

  return { bannedIps, block, blockMany, canBlock };
}
