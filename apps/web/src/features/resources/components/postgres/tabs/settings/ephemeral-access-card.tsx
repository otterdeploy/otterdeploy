/**
 * Ephemeral access — mint short-lived connection URLs (real Postgres roles
 * with a TTL) to hand to agents and scripts. The URL is shown exactly once at
 * mint time (see ephemeral-mint-dialog); this card is the lifecycle/audit view
 * with one-click revoke. Expired credentials are auto-disposed by the server's
 * sweeper.
 */

import { useState } from "react";

import { Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { PostgresBodyProps } from "../../types";

import { EphemeralMintDialog } from "./ephemeral-mint-dialog";
import { expiresIn } from "./ephemeral-shared";

export function EphemeralAccessCard({ resource }: { resource: PostgresBodyProps["resource"] }) {
  const [open, setOpen] = useState(false);

  const resourceId = resource.resourceId;
  const listQuery = useQuery({
    ...orpc.database.ephemeralList.queryOptions({ input: { resourceId } }),
    refetchInterval: 30_000,
  });
  const invalidateList = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.database.ephemeralList.queryKey({ input: { resourceId } }),
    });

  const revoke = useMutation({
    ...orpc.database.ephemeralRevoke.mutationOptions(),
    onSuccess: async () => {
      await invalidateList();
      toast.success("Credential revoked");
    },
    onError: (err) => toast.error(err.message ?? "Failed to revoke"),
  });

  const credentials = listQuery.data?.credentials ?? [];
  const activeCount = credentials.filter((c) => c.status === "active").length;

  return (
    <SettingsCard
      title="Ephemeral access"
      description="Short-lived connection URLs to hand to agents and scripts. Postgres refuses logins past the TTL and the platform disposes the role — nothing to clean up."
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0">
        <span className="text-[11px] text-muted-foreground">
          {activeCount > 0 ? `${activeCount} active` : "No active credentials"}
        </span>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-3.5" />
          Mint URL
        </Button>
      </div>

      {credentials.map((cred) => (
        <div
          key={cred.id}
          className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0"
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-[12.5px]">{cred.label || cred.roleName}</span>
            <span className="text-[11px] text-muted-foreground">
              {cred.scope}
              {" · "}
              {cred.status === "active" ? expiresIn(cred.expiresAt) : cred.status}
            </span>
          </div>
          {cred.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate({ resourceId, credentialId: cred.id })}
            >
              Revoke
            </Button>
          )}
        </div>
      ))}

      <EphemeralMintDialog
        resourceId={resourceId}
        open={open}
        onOpenChange={setOpen}
        onMinted={invalidateList}
      />
    </SettingsCard>
  );
}
