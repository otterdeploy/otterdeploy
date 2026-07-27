/**
 * Workspace SSO settings — register and remove the OIDC identity providers that
 * sign people into THIS workspace.
 *
 * Owner/admin only, and enforced twice on purpose: this page hides the controls,
 * and better-auth's own `/sso/providers` endpoint independently scopes its
 * result to organizations where the caller is an admin. The UI check is a
 * courtesy; the server one is the security boundary.
 */

import { useState } from "react";

import { Copy01Icon, Delete02Icon, ShieldKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { toast } from "sonner";

import { env } from "@otterdeploy/env/web";

import type { SsoProvider } from "@/features/sso/data/use-sso-providers";

import { useDeleteSsoProvider, useSsoProviders } from "@/features/sso/data/use-sso-providers";
import { RegisterProviderDialog } from "@/features/sso/register-provider-dialog";
import { useMembers } from "@/features/team/data/use-team";
import { Page, PageHeader } from "@/shared/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
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
import { copyToClipboard } from "@/shared/lib/clipboard";

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/sso")({
  staticData: { crumb: "SSO" },
  component: RouteComponent,
});

/** The redirect URI to paste into the IdP. Derived rather than stored, so it
 *  can never drift from the callback the server actually serves. */
function redirectUri(providerId: string): string {
  return `${env.VITE_SERVER_URL.replace(/\/$/, "")}/api/auth/sso/callback/${providerId}`;
}

function ProviderRow({
  provider,
  canManage,
  onRemove,
}: {
  provider: SsoProvider;
  canManage: boolean;
  onRemove: (providerId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const uri = redirectUri(provider.providerId);

  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <HugeiconsIcon
        icon={ShieldKeyIcon}
        strokeWidth={1.5}
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium">{provider.domain}</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {provider.providerId}
          </span>
        </div>
        <span className="truncate text-[11px] text-muted-foreground">{provider.issuer}</span>
        {provider.oidcConfig ? (
          <span className="font-mono text-[10px] text-muted-foreground/70">
            client ···{provider.oidcConfig.clientIdLastFour}
          </span>
        ) : null}

        {/* The one piece of setup that has to travel back to the IdP. Shown on
            every row rather than only at creation, because operators come back
            to it when re-configuring the provider months later. */}
        <div className="mt-1 flex items-center gap-1.5">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 font-mono text-[10px]">
            {uri}
          </code>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label="Copy redirect URI"
            // Insecure-context safe — `navigator.clipboard` is absent over
            // plain http://<ip>. See shared/lib/clipboard.ts.
            onClick={() => {
              void copyToClipboard(uri).then((ok) =>
                ok ? toast.success("Redirect URI copied") : toast.error("Couldn't copy"),
              );
            }}
          >
            <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        </div>
      </div>

      {canManage ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${provider.domain}`}
            onClick={() => setConfirming(true)}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          </Button>

          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this identity provider?</AlertDialogTitle>
                <AlertDialogDescription>
                  Anyone at <strong>{provider.domain}</strong> will immediately lose the ability
                  to sign in through it. Existing sessions keep working until they expire, and
                  accounts already in this workspace are not deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    onRemove(provider.providerId);
                    setConfirming(false);
                  }}
                >
                  Remove provider
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { user } = Route.useRouteContext();
  const organizationId = organization.id;
  const [adding, setAdding] = useState(false);

  const members = useMembers(organizationId);
  const myRole = members.data?.find((m) => m.userId === user.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  const providers = useSsoProviders(organizationId);
  const remove = useDeleteSsoProvider(organizationId);

  return (
    <Page>
      <PageHeader
        title="Single sign-on"
        description="Let people sign in with your organization's identity provider instead of a password."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              Add provider
            </Button>
          ) : null
        }
      />

      {providers.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-md" />
          ))}
        </div>
      ) : providers.isError ? (
        <ErrorState
          title="Couldn't load identity providers"
          message={providers.error instanceof Error ? providers.error.message : undefined}
          onRetry={() => void providers.refetch()}
        />
      ) : providers.data && providers.data.length > 0 ? (
        <div className="flex flex-col gap-2">
          {providers.data.map((provider) => (
            <ProviderRow
              key={provider.providerId}
              provider={provider}
              canManage={canManage}
              onRemove={(providerId) => {
                remove.mutate(providerId, {
                  onSuccess: () => toast.success("Provider removed"),
                  onError: (error) =>
                    toast.error(
                      error instanceof Error ? error.message : "Could not remove provider",
                    ),
                });
              }}
            />
          ))}
        </div>
      ) : (
        <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={ShieldKeyIcon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No identity providers</EmptyTitle>
            <EmptyDescription>
              Connect Okta, Entra ID, Google Workspace, Authentik or any other OIDC provider to
              sign your team in without passwords.
            </EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <Button size="sm" onClick={() => setAdding(true)}>
                Add provider
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}

      <RegisterProviderDialog
        organizationId={organizationId}
        open={adding}
        onOpenChange={setAdding}
      />
    </Page>
  );
}
