/**
 * The Firewall's two write paths and its refresh, lifted out of the view.
 *
 * Both mutations end the same way: tell the operator what happened, then drop
 * the decisions cache so every surface reading it (this table, the Flagged
 * tab's "already blocked" markers, the access log's row badges) agrees about
 * the new state. That used to be a `decisions.refetch()` on one query object,
 * which left the other readers stale until their own poll came round.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

export function useFirewallActions() {
  const queryClient = useQueryClient();
  const invalidateDecisions = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.firewall.decisions.key() });

  const block = useMutation({
    ...orpc.firewall.block.mutationOptions(),
    onSuccess: (r, vars) => {
      if (r.ok) {
        toast.success(`Blocked ${vars.ip}`);
        invalidateDecisions();
      } else {
        toast.error(r.error ?? "Block failed");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Block failed"),
  });

  const unblock = useMutation({
    ...orpc.firewall.unblock.mutationOptions(),
    onSuccess: (r, vars) => {
      if (r.ok) {
        toast.success(`Unblocked ${vars.ip}`);
        invalidateDecisions();
      } else {
        toast.error(r.error ?? "Unblock failed");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Unblock failed"),
  });

  /** Everything the view can show, refetched together. One button, because an
   *  operator refreshing a security page means "tell me what is true now", not
   *  "re-run whichever query this tab happens to be showing". Resolves when
   *  the refetches settle, so the button can spin for exactly that long. */
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.firewall.key() });

  return { block, unblock, refresh };
}
