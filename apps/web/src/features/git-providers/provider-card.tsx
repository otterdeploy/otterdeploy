import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreVerticalIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Button } from "@/shared/components/ui/button";
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

export function ConnectedProviderCard({
  provider,
}: {
  provider: ProviderView;
}) {
  const primary = provider.installations[0];
  if (!primary) return null;

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-start gap-3">
        <SvglLogo
          search={PROVIDER_SEARCH[provider.kind]}
          fallback={PROVIDER_LABEL[provider.kind]}
          size={28}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold">{provider.displayName}</span>
            <StatusBadge installation={primary} />
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
              GitHub App
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
            {primary.accountType === "organization" ? "org" : "user"}/
            {primary.accountLogin}
            {provider.installations.length > 1 && (
              <span className="ml-2 text-muted-foreground">
                +{provider.installations.length - 1} more
              </span>
            )}
          </div>
        </div>
        <InstallationActions installation={primary} />
      </div>

      <div className="mt-3.5 flex items-center gap-6 border-t pt-3">
        <Stat
          label="Repos"
          value={`${primary.repoCount}${primary.repoSelection === "selected" ? " (selected)" : ""}`}
        />
        <Stat label="Connected" value={formatRelative(primary.createdAt)} mono />
        <div className="flex-1" />
        <RefreshButton installationId={primary.id} />
      </div>
    </div>
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
        <SvglLogo
          search={PROVIDER_SEARCH[kind]}
          fallback={PROVIDER_LABEL[kind]}
          size={24}
        />
        <div className="flex flex-1 items-center gap-2">
          <span className="text-[13px] font-semibold">{PROVIDER_LABEL[kind]}</span>
          <span className="inline-flex items-center gap-1 rounded-sm border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
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

function InstallationActions({
  installation,
}: {
  installation: InstallationView;
}) {
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
  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() =>
          disconnect.mutate({ installationId: installation.id as never })
        }
        disabled={disconnect.isPending}
      >
        Disconnect
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="More">
        <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} />
      </Button>
    </div>
  );
}

function RefreshButton({ installationId }: { installationId: string }) {
  const refresh = useMutation({
    ...orpc.git.refreshRepos.mutationOptions(),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.git.list.queryKey({ input: undefined }),
      });
      toast.success(`Synced ${res.repoCount} repos`);
    },
    onError: (err) => toast.error(err.message ?? "Sync failed"),
  });
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() =>
        refresh.mutate({ installationId: installationId as never })
      }
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
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        tone,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-0.5 text-[12px]", mono && "font-mono")}>{value}</div>
    </div>
  );
}
