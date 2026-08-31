/**
 * The Firewall's refresh.
 *
 * This file used to hold the block and unblock mutations too. They are now
 * transactions over `./decisions`, because a `useMutation` per view meant one
 * `isPending` boolean shared by every row of a table: blocking one address
 * disabled the Block button on all the others, and nothing moved on screen
 * until the round-trip and the next poll had both landed.
 *
 * What is left is the read side. One button, because an operator refreshing a
 * security page means "tell me what is true now", not "re-run whichever tab
 * this happens to be showing" — so it drops the whole `firewall` cache, which
 * every surface reading it (both tables, the access log's row badges) then
 * re-answers together. Resolves when the refetches settle, so the button can
 * spin for exactly that long.
 */
import { useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

export function useFirewallActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.firewall.key() });
  return { refresh };
}
