/**
 * The operator's route on/off switch for one proxy route. Flips
 * `disabledByUser` on the shared `proxyRoutesCollection`: the optimistic
 * flip is instant and rolls back (with a toast) if the server rejects.
 * Deliberately separate from the system-owned `enabled` gate: pausing keeps
 * cert settings and verification state intact, so resuming needs nothing
 * re-proven.
 */

import { zId } from "@otterdeploy/shared/id";
import { toast } from "sonner";

import { proxyRoutesCollection } from "@/features/projects/data/proxy-routes";
import { Switch } from "@/shared/components/ui/switch";

// Brands the row's plain-string id at the boundary instead of asserting.
const routeIdSchema = zId("rt");

export function RouteEnabledSwitch({
  route,
}: {
  route: { id: string; domain: string; disabledByUser: boolean };
}) {
  const onToggle = (checked: boolean) => {
    const tx = proxyRoutesCollection.update(routeIdSchema.parse(route.id), (draft) => {
      draft.disabledByUser = !checked;
    });
    tx.isPersisted.promise
      .then(() => toast.success(checked ? `${route.domain} resumed` : `${route.domain} paused`))
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to update route"));
  };

  return (
    <Switch
      checked={!route.disabledByUser}
      onCheckedChange={onToggle}
      aria-label={`Serve ${route.domain}`}
    />
  );
}
