/**
 * Active CrowdSec bans + the block actions — shared plumbing for the edge-log
 * and firewall surfaces. Exposes the set of currently-banned client IPs (so
 * rows can carry a "blocked" marker and block buttons stay honest) and the
 * single/bulk block mutations, refreshing the set after every successful block.
 */
import { useMemo } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

export function useEdgeBans(onBlocked?: () => void) {
  const decisions = useQuery({
    ...orpc.firewall.decisions.queryOptions(),
    refetchInterval: 30_000,
  });
  const bannedIps = useMemo(
    () =>
      new Set(
        (decisions.data ?? []).flatMap((d) => (d.scope.toLowerCase() === "ip" ? [d.value] : [])),
      ),
    [decisions.data],
  );

  const settled = () => {
    void decisions.refetch();
    onBlocked?.();
  };
  const block = useMutation({
    ...orpc.firewall.block.mutationOptions(),
    onSuccess: (r, vars) => {
      if (r.ok) {
        toast.success(`Blocked ${vars.ip} — enforced at the edge`);
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
      if (r.ok) {
        toast.success(
          `Blocked ${r.blocked} IP${r.blocked === 1 ? "" : "s"} — enforced at the edge`,
        );
        settled();
      } else {
        toast.error(r.error ?? "Block failed");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Block failed"),
  });

  return { bannedIps, block, blockMany };
}
