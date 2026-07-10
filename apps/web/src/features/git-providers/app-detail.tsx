import type { GitProviderId } from "@otterdeploy/shared/id";

import { useState, type ReactNode } from "react";

import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

/** The provider-detail shape, inferred straight from the oRPC procedure. */
export type ProviderData = Awaited<ReturnType<typeof orpc.git.getProvider.call>>;

export function DeleteButton({ pending, onDelete }: { pending: boolean; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => (confirming ? onDelete() : setConfirming(true))}
      onBlur={() => setConfirming(false)}
    >
      {pending ? "Deleting…" : confirming ? "Confirm delete" : "Delete"}
    </Button>
  );
}

// ─── General ───

export function GeneralTab({ provider }: { provider: ProviderData }) {
  const inst = provider.installation;
  return (
    <div className="flex flex-col gap-6 rounded-lg border bg-card p-5">
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <Row label="App name" value={provider.displayName} />
        <Row
          label="Account"
          value={
            inst
              ? `${inst.accountType === "organization" ? "org" : "user"}/${inst.accountLogin}`
              : "—"
          }
          mono
        />
        <Row label="Host" value={provider.host} mono />
        <Row label="App ID" value={provider.externalAppId ?? "—"} mono />
        <Row label="Installation ID" value={inst?.installationId ?? "Not installed"} mono />
        <Row
          label="Repositories"
          value={
            // Null count = never fetched / revoked → "—" (a 0 here would
            // wrongly claim GitHub granted no repos).
            inst && inst.repoCount != null
              ? `${inst.repoCount}${inst.repoSelection === "selected" ? " (selected)" : " (all)"}`
              : "—"
          }
        />
        <Row label="Connected" value={new Date(provider.createdAt).toLocaleString()} />
        <Row label="Status" value={<InstallStatus provider={provider} />} />
      </dl>

      <div className="flex flex-col gap-2 border-t pt-4">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Credentials
        </span>
        <div className="flex flex-wrap gap-2">
          <SecretChip label="Client secret" ok={provider.secretsConfigured.clientSecret} />
          <SecretChip label="Webhook secret" ok={provider.secretsConfigured.webhookSecret} />
          <SecretChip label="Private key" ok={provider.secretsConfigured.privateKey} />
        </div>
        <p className="text-[11.5px] text-muted-foreground">
          Secrets are encrypted at rest and never shown. GitHub issued them when the App was
          created.
        </p>
      </div>
    </div>
  );
}

function InstallStatus({ provider }: { provider: ProviderData }) {
  const inst = provider.installation;
  const { label, tone } = !inst
    ? { label: "not installed", tone: "text-warning" }
    : inst.revokedAt
      ? { label: "revoked", tone: "text-destructive" }
      : inst.suspendedAt
        ? { label: "suspended", tone: "text-warning" }
        : { label: "active", tone: "text-success" };
  return <span className={cn("font-mono text-[12px] uppercase", tone)}>{label}</span>;
}

// ─── Permissions ───

export function PermissionsTab({ provider }: { provider: ProviderData }) {
  const inst = provider.installation;
  const refetch = useMutation({
    ...orpc.git.refetchPermissions.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.git.getProvider.queryKey({ input: { providerId: provider.id } }),
      });
      toast.success("Permissions refreshed");
    },
    onError: (err) => toast.error(err.message ?? "Refetch failed"),
  });

  const entries = inst ? Object.entries(inst.permissions) : [];

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Granted permissions</span>
        {inst ? (
          <Button
            variant="outline"
            size="sm"
            disabled={refetch.isPending}
            onClick={() => refetch.mutate({ installationId: inst.id })}
          >
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
            {refetch.isPending ? "Refetching…" : "Refetch"}
          </Button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          {inst
            ? "No permissions recorded yet — try Refetch."
            : "Install the App to see its permissions."}
        </p>
      ) : (
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {entries.map(([scope, level]) => (
            <div key={scope} className="flex items-center justify-between border-b pb-2">
              <dt className="font-mono text-[12.5px] text-foreground">{scope}</dt>
              <dd className="font-mono text-[11.5px] tracking-wider text-muted-foreground uppercase">
                {level}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ─── Resources ───

export function ResourcesTab({
  orgSlug,
  providerId,
}: {
  orgSlug: string;
  providerId: GitProviderId;
}) {
  const query = useQuery(orpc.git.resources.queryOptions({ input: { providerId } }));

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-lg border bg-card py-12">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        title="Couldn't load resources"
        message={query.error?.message}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const rows = query.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-5 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No projects deploy from this GitHub App yet. Bind a repository in a project's build
          settings to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-left text-[12.5px]">
        <thead className="border-b text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
          <tr>
            <th className="px-4 py-2.5">Project</th>
            <th className="px-4 py-2.5">Repository</th>
            <th className="px-4 py-2.5">Branch</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.projectId} className="border-b last:border-0">
              <td className="px-4 py-2.5">
                <Link
                  to="/$orgSlug/$projectSlug"
                  params={{ orgSlug, projectSlug: r.projectSlug as never }}
                  className="font-medium text-foreground hover:text-primary hover:underline"
                >
                  {r.projectName}
                </Link>
              </td>
              <td className="px-4 py-2.5 font-mono text-muted-foreground">{r.repoFullName}</td>
              <td className="px-4 py-2.5 font-mono text-muted-foreground">
                {r.productionBranch ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── bits ───

function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={cn("text-[13px] text-foreground", mono && "font-mono text-[12.5px]")}>
        {value}
      </dd>
    </div>
  );
}

function SecretChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11.5px] font-medium",
        ok
          ? "border-success/30 bg-success/10 text-success"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}: {ok ? "configured" : "missing"}
    </span>
  );
}
