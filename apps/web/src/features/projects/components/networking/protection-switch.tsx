/**
 * The auth-wall (deployment protection) toggle for one HTTP route. Shared
 * by the Routes-table cell and the Networking → Access tab so the toast +
 * route-list invalidation stay identical across both surfaces.
 */

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

export function ProtectionSwitch({
  route,
  projectId,
}: {
  route: { id: string; protected: boolean };
  projectId: string;
}) {
  const setProtection = useMutation({
    ...orpc.project.proxyRoute.setProtection.mutationOptions(),
    onSuccess: (updated) => {
      toast.success(
        updated.protected
          ? "Deployment protection enabled"
          : "Deployment protection disabled",
      );
      void queryClient.invalidateQueries({
        queryKey: orpc.project.proxyRoute.list.queryKey({
          input: { projectId: projectId as never },
        }),
      });
    },
    onError: (err) => toast.error(err.message ?? "Failed to update protection"),
  });

  return (
    <Switch
      checked={route.protected}
      disabled={setProtection.isPending}
      onCheckedChange={(checked) =>
        setProtection.mutate({ routeId: route.id as never, protected: checked })
      }
      aria-label="Require login to view this deployment"
    />
  );
}
