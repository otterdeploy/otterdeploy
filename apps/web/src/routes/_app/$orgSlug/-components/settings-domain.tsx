import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc, queryClient } from "@/shared/server/orpc";

function invalidateSettings(organizationId: never) {
  return queryClient.invalidateQueries({
    queryKey: orpc.organization.settings.queryKey({
      input: { organizationId },
    }),
  });
}

type DomainStatus = "unset" | "pending" | "verified";

function domainStatus(current: string, verifiedAt: unknown): DomainStatus {
  if (!current) return "unset";
  return verifiedAt ? "verified" : "pending";
}

export function DomainCard({ organizationId }: { organizationId: never }) {
  const settingsQuery = useQuery(
    orpc.organization.settings.queryOptions({ input: { organizationId } }),
  );
  const setBaseDomain = useMutation({
    ...orpc.organization.setBaseDomain.mutationOptions(),
    onSuccess: async () => {
      await invalidateSettings(organizationId);
      toast.success("Domain saved");
    },
    onError: (err) => toast.error(err.message ?? "Failed to save domain"),
  });

  const [value, setValue] = useState<string | null>(null);
  const current = settingsQuery.data?.baseDomain ?? "";
  const displayed = value ?? current;
  const dirty = displayed.trim().toLowerCase() !== current.toLowerCase();

  const verifiedAt = settingsQuery.data?.baseDomainVerifiedAt ?? null;
  const verifyToken = settingsQuery.data?.baseDomainVerifyToken ?? null;
  const status = domainStatus(current, verifiedAt);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Domain
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground/80">
          The apex domain your resources are published under. A service{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">
            web
          </code>{" "}
          in project{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">
            myproj
          </code>{" "}
          lands at{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">
            web-myproj.apps.&lt;baseDomain&gt;
          </code>
          . Leave blank to use the platform default (sslip.io fallback when no
          domain is set).
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium">Base domain</span>
          <StatusBadge status={status} />
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="acme.com"
            value={displayed}
            onChange={(e) => setValue(e.target.value)}
            disabled={setBaseDomain.isPending || settingsQuery.isLoading}
            className="font-mono text-[13px]"
          />
          <Button
            type="button"
            size="sm"
            disabled={!dirty || setBaseDomain.isPending}
            onClick={() =>
              setBaseDomain.mutate({
                organizationId,
                baseDomain: displayed.trim(),
              })
            }
          >
            {setBaseDomain.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        {status === "pending" && verifyToken && (
          <PendingVerification
            organizationId={organizationId}
            current={current}
            verifyToken={verifyToken}
            cloudflareConfigured={
              settingsQuery.data?.cloudflareTokenConfigured ?? false
            }
          />
        )}
      </div>
    </section>
  );
}

function PendingVerification({
  organizationId,
  current,
  verifyToken,
  cloudflareConfigured,
}: {
  organizationId: never;
  current: string;
  verifyToken: string;
  cloudflareConfigured: boolean;
}) {
  const verifyBaseDomain = useMutation({
    ...orpc.organization.verifyBaseDomain.mutationOptions(),
    onSuccess: async (result) => {
      await invalidateSettings(organizationId);
      if (result.ok) {
        toast.success("Domain verified");
      } else {
        toast.error(verifyReasonMessage(result));
      }
    },
    onError: (err) => toast.error(err.message ?? "Verification failed"),
  });
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5 text-[11.5px] text-warning">
      <div className="font-medium">Pending verification</div>
      <div className="text-warning/85">
        Add a TXT record to your DNS so we can prove you own this domain. Once
        the record propagates, hit Verify.
      </div>
      <pre className="overflow-x-auto rounded bg-warning/10 px-2 py-1.5 font-mono text-[11px] text-warning/90">
        {`Name:  _otterdeploy-verify.${current}\nType:  TXT\nValue: ${verifyToken}`}
      </pre>
      <div className="flex items-center justify-end gap-2">
        {cloudflareConfigured && (
          <CloudflareAutoConfigureButton organizationId={organizationId} />
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={verifyBaseDomain.isPending}
          onClick={() => verifyBaseDomain.mutate({ organizationId })}
        >
          {verifyBaseDomain.isPending ? "Verifying…" : "Verify"}
        </Button>
      </div>
    </div>
  );
}

function CloudflareAutoConfigureButton({
  organizationId,
}: {
  organizationId: never;
}) {
  const auto = useMutation({
    ...orpc.organization.autoConfigureBaseDomain.mutationOptions(),
    onSuccess: async (result) => {
      await invalidateSettings(organizationId);
      if (result.ok) {
        toast.success("DNS configured and domain verified");
      } else if (result.verify.reason === "no-record") {
        toast.message(
          "Records created. DNS is still propagating — try Verify in a moment.",
        );
      } else {
        toast.error("Records created but verification didn't pass.");
      }
    },
    onError: (err) => toast.error(err.message ?? "Auto-configure failed"),
  });
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={auto.isPending}
      onClick={() => auto.mutate({ organizationId })}
    >
      {auto.isPending ? "Configuring…" : "Auto-configure DNS"}
    </Button>
  );
}

function verifyReasonMessage(result: {
  reason: string;
  found: string[];
  expected: string;
  errorMessage?: string;
}): string {
  switch (result.reason) {
    case "no-record":
      return "No TXT record yet. DNS can take a few minutes to propagate — try again shortly.";
    case "value-mismatch":
      return `TXT record found but value didn't match. Expected ${result.expected}, saw ${result.found.join(", ") || "(empty)"}`;
    case "lookup-failed":
      return `DNS lookup failed: ${result.errorMessage ?? "unknown error"}`;
    case "missing-token":
      return "No verify token on file. Save the domain first.";
    default:
      return "Verification failed.";
  }
}

function StatusBadge({ status }: { status: DomainStatus }) {
  const label =
    status === "verified"
      ? "VERIFIED"
      : status === "pending"
        ? "PENDING"
        : "NOT SET";
  const tone =
    status === "verified"
      ? "bg-success/15 text-success border-success/30"
      : status === "pending"
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-muted text-muted-foreground border-border/60";
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium uppercase ${tone}`}
    >
      {label}
    </span>
  );
}
