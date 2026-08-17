/**
 * Workspace secret providers — connect HashiCorp Vault / OpenBao, Infisical
 * or Doppler so env vars can reference externally-managed secrets as
 * `${{vault.<provider>.<ref>}}`. Values resolve at deploy time and are never
 * stored by otterdeploy; only each provider's own credential is kept,
 * encrypted at rest.
 *
 * Lives in the operational shell's Workspace group (moved out of
 * Settings → Workspace): connecting a provider, rotating its credential and
 * re-testing it are operating tasks you return to, not one-time setup.
 *
 * Owner/admin only for mutations — the UI hides the controls as a courtesy,
 * and the `vaultProvider` RBAC statement on the router is the boundary.
 */

import { useState } from "react";

import { InformationCircleIcon, LockKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { VaultProvider } from "@/features/vault-providers/data/vault-providers";

import {
  KIND_REF_HINTS,
  useVaultProviders,
} from "@/features/vault-providers/data/vault-providers";
import { ProviderDialog } from "@/features/vault-providers/provider-dialog";
import { ProviderRow } from "@/features/vault-providers/provider-row";
import { useCanManageWorkspace } from "@/features/team/data/use-team";
import { Page, PageHeader } from "@/shared/components/page";
import { orpc, queryClient } from "@/shared/server/orpc";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { Skeleton } from "@/shared/components/ui/skeleton";

export const Route = createFileRoute("/_app/$orgSlug/_shell/secrets")({
  staticData: { crumb: "Secrets" },
  // Warm the provider list on hover (intent-preload) — same query
  // `useVaultProviders` reads. Non-blocking + best-effort.
  loader: () => {
    void queryClient
      .prefetchQuery(orpc.vaultProvider.list.queryOptions({ input: {} }))
      .catch(() => undefined);
  },
  component: RouteComponent,
});

/** The reference-token grammar, tucked behind an info button — standing
 *  explainer boxes read as clutter to anyone past their first visit. */
function SyntaxHelp() {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label={t("vault.syntaxLabel")}
          />
        }
      >
        <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 text-[12px] text-muted-foreground">
        <p>
          {t("vault.syntaxBefore")}{" "}
          <code className="font-mono text-foreground">{"KEY=${{vault.<provider>.<ref>}}"}</code>{" "}
          {t("vault.syntaxAfter")}
        </p>
        <ul className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11px]">
          <li>HashiCorp Vault: {KIND_REF_HINTS.hashicorp}</li>
          <li>Infisical: {KIND_REF_HINTS.infisical}</li>
          <li>Doppler: {KIND_REF_HINTS.doppler}</li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function RouteComponent() {
  const { t } = useTranslation();
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { user } = Route.useRouteContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VaultProvider | null>(null);

  const canManage = useCanManageWorkspace(organization.id, user.id);

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
        title={t("vault.title")}
        description={t("vault.description")}
        actions={
          <>
            <SyntaxHelp />
            {canManage ? (
              <Button size="sm" onClick={openCreate}>
                {t("vault.addProvider")}
              </Button>
            ) : null}
          </>
        }
      />

      {providers.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-md" />
          ))}
        </div>
      ) : providers.isError ? (
        <ErrorState
          title={t("vault.loadError")}
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
            <EmptyTitle>{t("vault.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("vault.emptyDescription")}</EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <Button size="sm" onClick={openCreate}>
                {t("vault.addProvider")}
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
