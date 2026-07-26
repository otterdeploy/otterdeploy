/**
 * Operator knobs that used to require editing `.env` and restarting: the
 * outbound egress allowlist, PR-preview idle teardown, edge-log persistence and
 * retention, the GeoIP mirrors, and builder concurrency.
 *
 * Two of these genuinely cannot hot-reload — edge-log persistence decides
 * whether the writer loop is constructed at server start, and BullMQ fixes a
 * worker's concurrency when it's created. Their rows say so rather than
 * implying the change is live, which is the honest-about-system-state rule in
 * PRODUCT.md.
 */

import { useState, type ReactNode } from "react";

import type { OrganizationId } from "@otterdeploy/shared/id";
import { Settings02Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsFooter, SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import { orpc, queryClient } from "@/shared/server/orpc";

interface Draft {
  egressAllowlist: string;
  previewIdleTeardownHours: number;
  edgeLogPersist: boolean;
  edgeLogRetentionDays: number;
  edgeLogGeoipUrl: string;
  edgeLogGeoipAsnUrl: string;
  builderConcurrency: number;
}

/** Placeholder shape for the pre-fetch render only — the server's values
 *  overwrite every field the moment the query resolves. */
const EMPTY_DRAFT: Draft = {
  egressAllowlist: "",
  previewIdleTeardownHours: 72,
  edgeLogPersist: false,
  edgeLogRetentionDays: 7,
  edgeLogGeoipUrl: "",
  edgeLogGeoipAsnUrl: "",
  builderConcurrency: 1,
};

/** A bounded integer setting with its unit — the shape four of these rows
 *  share, extracted so the card body stays readable. */
function NumberRow({
  title,
  description,
  unit,
  badge,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  title: string;
  description: ReactNode;
  unit?: string;
  badge?: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <div className="flex items-center gap-2.5">
          {badge && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {badge}
            </Badge>
          )}
          <Input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-24 font-mono text-[12.5px]"
            disabled={disabled}
          />
          {unit && <span className="text-[12px] text-muted-foreground">{unit}</span>}
        </div>
      }
    />
  );
}

/** A full-width free-text setting (URLs, the allowlist). */
function TextRow({
  title,
  description,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  title: string;
  description?: ReactNode;
  value: string;
  placeholder?: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <SettingsRow
      stacked
      title={title}
      description={description}
      control={
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono text-[12.5px]"
          disabled={disabled}
        />
      }
    />
  );
}

export function RuntimeSettingsCard({ organizationId }: { organizationId: OrganizationId }) {
  const query = useQuery(
    orpc.organization.getRuntimeSettings.queryOptions({ input: { organizationId } }),
  );

  // One draft object, null until the operator touches something — so a
  // background refetch never overwrites a half-finished edit.
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = useMutation({
    ...orpc.organization.setRuntimeSettings.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.getRuntimeSettings.queryKey({ input: { organizationId } }),
      });
      setDraft(null);
      toast.success("Runtime settings saved");
    },
    onError: (err) => toast.error(err.message ?? "Failed to save runtime settings"),
  });

  const server = query.data;
  // Fall back to the schema defaults until the first fetch lands, so every row
  // below reads a plain value — no `?.`/`??` threaded through the markup, and
  // the inputs are never uncontrolled.
  const value: Draft = draft ?? { ...EMPTY_DRAFT, ...server };
  const busy = save.isPending || query.isLoading;
  const fromEnvNote = server?.egressFromEnv === true;
  const sinkConfigured = server?.edgeLogSinkConfigured === true;

  const patch = (next: Partial<Draft>) => setDraft({ ...value, ...next });

  return (
    <SettingsSection
      icon={Settings02Icon}
      title="Runtime"
      description="Install-wide operational settings. Seeded from the environment; a value saved here takes over from it."
    >
      <SettingsRow
        stacked
        title="Outbound egress allowlist"
        description={
          <>
            Bare IPs or CIDRs (comma-separated) that tenant-supplied destinations
            — webhooks, notification channels, registry probes — are allowed to
            reach. Empty means nothing private is reachable, which is the
            default. Hostnames are rejected: one could be rebound to a private
            address after validation. This can never re-permit the control
            plane&apos;s own addresses.
            {fromEnvNote && " Currently showing the environment value."}
          </>
        }
        control={
          <Textarea
            value={value.egressAllowlist}
            onChange={(e) => patch({ egressAllowlist: e.target.value })}
            placeholder="192.168.1.10, 10.0.0.0/24"
            rows={2}
            className="font-mono text-[12.5px]"
            disabled={busy}
          />
        }
      />

      <NumberRow
        title="Preview idle teardown"
        description="Hours of inactivity before an open PR preview is torn down. 0 disables idle teardown entirely; a keep-alive pin always exempts a preview."
        unit="hours"
        value={value.previewIdleTeardownHours}
        min={0}
        max={8760}
        disabled={busy}
        onChange={(next) => patch({ previewIdleTeardownHours: next })}
      />

      <SettingsRow
        title="Persist edge logs"
        description={
          sinkConfigured
            ? "Write access logs to Postgres behind the live tail, enabling the 24h/7d ranges and percentiles. Takes effect when the server restarts."
            : "Edge logging is off — no log sink is configured, so this has no effect."
        }
        control={
          <Switch
            checked={value.edgeLogPersist}
            disabled={busy || !sinkConfigured}
            onCheckedChange={(checked) => patch({ edgeLogPersist: checked })}
          />
        }
      />

      <NumberRow
        title="Edge log retention"
        description="Days of access logs to keep. Expired days are dropped whole, hourly — shortening this reclaims disk on the next sweep."
        unit="days"
        value={value.edgeLogRetentionDays}
        min={1}
        max={365}
        disabled={busy}
        onChange={(next) => patch({ edgeLogRetentionDays: next })}
      />

      <TextRow
        title="GeoIP database URL"
        description="Source for the IP→country database downloaded on first use. Point at a mirror for an air-gapped install."
        value={value.edgeLogGeoipUrl}
        disabled={busy}
        onChange={(next) => patch({ edgeLogGeoipUrl: next })}
      />

      <TextRow
        title="ASN database URL"
        description="Companion IP→ASN database, same download semantics."
        value={value.edgeLogGeoipAsnUrl}
        disabled={busy}
        onChange={(next) => patch({ edgeLogGeoipAsnUrl: next })}
      />

      <NumberRow
        title="Builder concurrency"
        description="Deploy jobs the builder pulls from the queue at once. Higher values contend on the Docker daemon. Read when the builder starts, so this needs a builder restart to take effect."
        badge="Restart"
        value={value.builderConcurrency}
        min={1}
        max={32}
        disabled={busy}
        onChange={(next) => patch({ builderConcurrency: next })}
      />

      <SettingsFooter>
        {draft !== null && (
          <span className="text-[11.5px] text-muted-foreground">Unsaved changes</span>
        )}
        <Button
          size="sm"
          disabled={draft === null || save.isPending}
          onClick={() => draft && save.mutate({ organizationId, ...draft })}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}
