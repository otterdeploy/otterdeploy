/**
 * Workspace secret-provider settings — connect HashiCorp Vault / OpenBao,
 * Infisical or Doppler so env vars can reference externally-managed secrets
 * as `${{vault.<provider>.<ref>}}`. Values resolve at deploy time and are
 * never stored by otterdeploy; only each provider's own credential is kept,
 * encrypted at rest.
 *
 * Owner/admin only for mutations — the UI hides the controls as a courtesy,
 * and the `vaultProvider` RBAC statement on the router is the boundary.
 */

import { useState } from "react";

import { LockKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import type { VaultProvider } from "@/features/vault-providers/data/vault-providers";

import {
  KIND_REF_HINTS,
  useVaultProviders,
} from "@/features/vault-providers/data/vault-providers";
import { ProviderDialog } from "@/features/vault-providers/provider-dialog";
import { ProviderRow } from "@/features/vault-providers/provider-row";
import { useMembers } from "@/features/team/data/use-team";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/secret-providers")({
  staticData: { crumb: "Secret providers" },
  component: RouteComponent,
});

function SyntaxHelp() {
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-[12px] text-muted-foreground">
      <p>
        Reference a secret from any variable value as{" "}
        <code className="font-mono text-foreground">{"KEY=${{vault.<provider>.<ref>}}"}</code> —
        it's fetched from the provider on every deploy, never stored here.
      </p>
      <ul className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11px]">
        <li>HashiCorp Vault: {KIND_REF_HINTS.hashicorp}</li>
        <li>Infisical: {KIND_REF_HINTS.infisical}</li>
        <li>Doppler: {KIND_REF_HINTS.doppler}</li>
      </ul>
    </div>
  );
}

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { user } = Route.useRouteContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VaultProvider | null>(null);

  const members = useMembers(organization.id);
  const myRole = members.data?.find((m) => m.userId === user.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  const providers = useVaultProviders();

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (provider: VaultProvider) => {
    setEditing(provider);
    setDialogOpen(true);
  };

  return (
    <Page>
      <PageHeader
        title="Secret providers"
        description="Pull env-var values from an external secret manager at deploy time instead of storing them here."
        actions={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              Add provider
            </Button>
          ) : null
        }
      />

      <SyntaxHelp />

      {providers.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-md" />
          ))}
        </div>
      ) : providers.isError ? (
        <ErrorState
          title="Couldn't load secret providers"
          message={providers.error instanceof Error ? providers.error.message : undefined}
          onRetry={() => void providers.refetch()}
        />
      ) : providers.data && providers.data.length > 0 ? (
        <div className="flex flex-col gap-2">
          {providers.data.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              canManage={canManage}
              onEdit={openEdit}
            />
          ))}
        </div>
      ) : (
        <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={LockKeyIcon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No secret providers</EmptyTitle>
            <EmptyDescription>
              Connect HashiCorp Vault, OpenBao, Infisical or Doppler and reference their secrets
              from any service's variables without copying values into otterdeploy.
            </EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <Button size="sm" onClick={openCreate}>
                Add provider
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}

      {/* Keyed so switching create ↔ edit (or between rows) remounts the
          form with fresh defaults instead of keeping stale field state. */}
      <ProviderDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />
    </Page>
  );
}
