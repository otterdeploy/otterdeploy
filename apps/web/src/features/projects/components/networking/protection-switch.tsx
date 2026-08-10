/**
 * The auth-wall (deployment protection) toggle for one HTTP route. Shared
 * by the Routes-table cell and the Networking → Access tab. Mutates the
 * shared `proxyRoutesCollection`: the optimistic flip is instant and rolls
 * back (with a toast) if the server rejects.
 */

import type { ProxyRouteId } from "@otterdeploy/shared/id";

import { toast } from "sonner";

import { proxyRoutesCollection } from "@/features/projects/data/proxy-routes";
import { Switch } from "@/shared/components/ui/switch";

/**
 * The word beside the switch, in a box sized to the longer of the two states.
 *
 * "public" and "login required" differ by eight monospace characters, so an
 * intrinsically-sized label moved the switch out from under the pointer on
 * every toggle, and in the Routes table it resized the shared column with it.
 * Both call sites get the fixed box from here rather than repeating the width.
 */
export function ProtectionStateLabel({ isProtected }: { isProtected: boolean }) {
  return (
    <span className="w-[14ch] shrink-0 font-mono text-[11px] text-muted-foreground">
      {isProtected ? "login required" : "public"}
    </span>
  );
}

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
