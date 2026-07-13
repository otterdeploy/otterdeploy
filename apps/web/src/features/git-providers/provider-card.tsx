import { MoreVerticalIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isDefinedError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import {
  formatRelative,
  PROVIDER_LABEL,
  PROVIDER_SEARCH,
  SUPPORTED_KINDS,
  type InstallationView,
  type ProviderKind,
  type ProviderView,
} from "./shared";

export function ConnectedProviderCard({ provider }: { provider: ProviderView }) {
  const { orgSlug } = useParams({ from: "/_app/$orgSlug/settings/workspace/git-providers" });
  const reinstall = useGithubReinstall();
  if (provider.installations.length === 0) return null;

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center gap-3">
        <SvglLogo
          search={PROVIDER_SEARCH[provider.kind]}
          fallback={PROVIDER_LABEL[provider.kind]}
          size={28}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Link
            to="/$orgSlug/settings/workspace/github-app/$providerId"
            params={{ orgSlug, providerId: provider.id }}
            className="text-[13.5px] font-semibold hover:text-primary hover:underline"
          >
            {provider.displayName}
          </Link>
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10.5px] font-medium tracking-wider text-muted-foreground uppercase">
            GitHub App
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={reinstall.run}
          disabled={reinstall.isPending}
          className="text-muted-foreground"
        >
          {reinstall.isPending ? "Redirecting…" : "Reinstall"}
        </Button>
      </div>

      {/* One row per installation — every account the App is installed on is
          visible with its own status + actions, never a "+N more" mystery. */}
      <ul className="mt-3 divide-y border-t">
        {provider.installations.map((installation) => (
          <InstallationRow
            key={installation.id}
            installation={installation}
            onReinstall={reinstall.run}
          />
        ))}
      </ul>
    </div>
  );
}

function InstallationRow({
  installation,
  onReinstall,
}: {
  installation: InstallationView;
  onReinstall: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-[12px]">
            {installation.accountType === "organization" ? "org" : "user"}/
            {installation.accountLogin}
          </span>
          <StatusBadge installation={installation} />
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {/* null = count never fetched (or install revoked) — "—" is honest;
              a rendered 0 would claim GitHub granted no repos. */}
          {installation.repoCount ?? "—"} repos
          {installation.repoSelection === "selected" ? " (selected)" : ""}
          {" · connected "}
          {formatRelative(installation.createdAt)}
        </div>
      </div>
      {/* Syncing a revoked installation can only fail — hide it and leave the
          menu (Manage on GitHub / Disconnect) as the cleanup path. */}
      {!installation.revokedAt && (
        <RefreshButton installationId={installation.id} onReinstall={onReinstall} />
      )}
      <InstallationActions installation={installation} />
    </li>
  );
}

export function DisconnectedProviderCard({
  kind,
  onConnect,
}: {
  kind: ProviderKind;
  onConnect: () => void;
}) {
  const supported = SUPPORTED_KINDS.has(kind);
  return (
    <div className="rounded-md border bg-card p-3.5">
      <div className="flex items-center gap-3">
        <SvglLogo search={PROVIDER_SEARCH[kind]} fallback={PROVIDER_LABEL[kind]} size={24} />
        <div className="flex flex-1 items-center gap-2">
          <span className="text-[13px] font-semibold">{PROVIDER_LABEL[kind]}</span>
          <span className="inline-flex items-center gap-1 rounded-sm border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            <span className="size-1.5 rounded-full bg-muted-foreground/60" />
            {supported ? "not connected" : "coming soon"}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={supported ? onConnect : undefined}
          disabled={!supported}
        >
          Connect
        </Button>
      </div>
    </div>
  );
}

function InstallationActions({ installation }: { installation: InstallationView }) {
  const disconnect = useMutation({
    ...orpc.git.disconnect.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.git.list.queryKey({ input: undefined }),
      });
      toast.success("Disconnected");
    },
    onError: (err) => toast.error(err.message ?? "Disconnect failed"),
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
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => window.open(manageUrl, "_blank", "noopener,noreferrer")}>
          Manage on GitHub
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => disconnect.mutate({ installationId: installation.id })}
          disabled={disconnect.isPending}
        >
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Kicks off a GitHub App (re)install — `startConnect` returns a fresh install
 * URL for the org's App and we hand the browser to GitHub. The install page is
 * where the user picks the target account/org + repos; the callback then
 * re-syncs a valid installation. This is the standard recovery when GitHub no
 * longer recognizes an installation.
 */
function useGithubReinstall() {
  // Carry the page's returnTo through the GitHub round-trip so the operator
  // lands back where they started the connect (e.g. the deploy wizard).
  const { returnTo } = useSearch({ from: "/_app/$orgSlug/settings/workspace/git-providers" });
  const startConnect = useMutation({
    ...orpc.git.startConnect.mutationOptions(),
    onSuccess: (res) => {
      window.location.href = res.redirectUrl;
    },
    onError: (err) => toast.error(err.message ?? "Couldn't start reinstall"),
  });
  return {
    run: () => startConnect.mutate({ kind: "github", returnTo }),
    isPending: startConnect.isPending,
  };
}

function RefreshButton({
  installationId,
  onReinstall,
}: {
  installationId: string;
  onReinstall: () => void;
}) {
  const refresh = useMutation({
    ...orpc.git.refreshRepos.mutationOptions(),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.git.list.queryKey({ input: undefined }),
      });
      toast.success(`Synced ${res.repoCount} repos`);
    },
    onError: (err) => {
      // A no-longer-valid installation is recoverable — put "Reinstall" right
      // in the toast so the failure isn't a dead end.
      const needsReinstall = isDefinedError(err) && err.code === "REINSTALL_REQUIRED";
      toast.error(
        err.message ?? "Sync failed",
        needsReinstall ? { action: { label: "Reinstall", onClick: onReinstall } } : undefined,
      );
    },
  });
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => refresh.mutate({ installationId })}
      disabled={refresh.isPending}
    >
      <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
      {refresh.isPending ? "Syncing…" : "Sync now"}
    </Button>
  );
}

function StatusBadge({ installation }: { installation: InstallationView }) {
  const tone = installation.revokedAt
    ? "bg-destructive/15 text-destructive border-destructive/30"
    : installation.suspendedAt
      ? "bg-warning/15 text-warning border-warning/30"
      : "bg-success/15 text-success border-success/30";
  const label = installation.revokedAt
    ? "revoked"
    : installation.suspendedAt
      ? "suspended"
      : "active";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase",
        tone,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
