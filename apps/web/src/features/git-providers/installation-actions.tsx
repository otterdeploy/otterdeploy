import { MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { InstallationView } from "./shared";

/** The ⋮ menu on a connected provider card: Manage on GitHub, Disconnect
 *  (soft-revoke), Delete (remove the whole App connection). */
export function InstallationActions({
  installation,
  providerId,
}: {
  installation: InstallationView;
  providerId: string;
}) {
  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: orpc.git.list.queryKey({ input: undefined }) });

  const disconnect = useMutation({
    ...orpc.git.disconnect.mutationOptions(),
    onSuccess: async () => {
      await invalidateList();
      toast.success("Disconnected");
    },
    onError: (err) => toast.error(err.message ?? "Disconnect failed"),
  });

  const del = useMutation({
    ...orpc.git.deleteProvider.mutationOptions(),
    onSuccess: async () => {
      await invalidateList();
      toast.success("GitHub App deleted");
    },
    onError: (err) => toast.error(err.message ?? "Delete failed"),
  });

  // GitHub's per-installation settings page (add/remove repos, uninstall).
  const manageUrl =
    installation.accountType === "organization"
      ? `https://github.com/organizations/${installation.accountLogin}/settings/installations/${installation.installationId}`
      : `https://github.com/settings/installations/${installation.installationId}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="More" />}>
        <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => window.open(manageUrl, "_blank", "noopener,noreferrer")}>
          Manage on GitHub
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Disconnect = soft-revoke the installation (keeps deploy history). */}
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => disconnect.mutate({ installationId: installation.id as never })}
          disabled={disconnect.isPending}
        >
          Disconnect
        </DropdownMenuItem>
        {/* Delete = remove the whole GitHub App connection + its credentials. */}
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => del.mutate({ providerId: providerId as never })}
          disabled={del.isPending}
        >
          Delete GitHub App
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
