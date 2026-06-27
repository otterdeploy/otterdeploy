/**
 * The auth-wall (deployment protection) toggle for one HTTP route. Shared
 * by the Routes-table cell and the Networking → Access tab. Mutates the
 * shared `proxyRoutesCollection` — the optimistic flip is instant and rolls
 * back (with a toast) if the server rejects.
 */

import type { ProxyRouteId } from "@otterdeploy/shared/id";

import { toast } from "sonner";

import { proxyRoutesCollection } from "@/features/projects/data/proxy-routes";
import { Switch } from "@/shared/components/ui/switch";

export function ProtectionSwitch({
  route,
}: {
  route: { id: string; protected: boolean };
  projectId: string;
}) {
  const onToggle = (checked: boolean) => {
    const tx = proxyRoutesCollection.update(route.id as ProxyRouteId, (draft) => {
      draft.protected = checked;
    });
    tx.isPersisted.promise
      .then(() =>
        toast.success(checked ? "Deployment protection enabled" : "Deployment protection disabled"),
      )
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Failed to update protection"),
      );
  };

  return (
    <Switch
      checked={route.protected}
      onCheckedChange={onToggle}
      aria-label="Require login to view this deployment"
    />
  );
}
