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

import { useState } from "react";

import type { OrganizationId } from "@otterdeploy/shared/id";
import { Settings02Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsFooter, SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import {
  EMPTY_DRAFT,
  FieldError,
  NumberRow,
  TextRow,
  validate,
  type Draft,
  type FieldErrors,
} from "./instance-runtime-fields";
import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import { orpc, queryClient } from "@/shared/server/orpc";

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

  // Only surface errors once the operator has actually edited something —
  // an untouched card must not open covered in red because the server's
  // stored value predates a rule.
  const errors: FieldErrors = draft === null ? {} : validate(draft);
  const hasErrors = Object.keys(errors).length > 0;

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
          <div>
            <Textarea
              value={value.egressAllowlist}
              onChange={(e) => patch({ egressAllowlist: e.target.value })}
              placeholder="192.168.1.10, 10.0.0.0/24"
              rows={2}
              aria-invalid={errors.egressAllowlist ? true : undefined}
              className="font-mono text-[12.5px]"
              disabled={busy}
            />
            <FieldError message={errors.egressAllowlist} />
          </div>
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
        error={errors.previewIdleTeardownHours}
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
        error={errors.edgeLogRetentionDays}
        onChange={(next) => patch({ edgeLogRetentionDays: next })}
      />

      <TextRow
        title="GeoIP database URL"
        description="Source for the IP→country database downloaded on first use. Point at a mirror for an air-gapped install."
        value={value.edgeLogGeoipUrl}
        disabled={busy}
        error={errors.edgeLogGeoipUrl}
        onChange={(next) => patch({ edgeLogGeoipUrl: next })}
      />

      <TextRow
        title="ASN database URL"
        description="Companion IP→ASN database, same download semantics."
        value={value.edgeLogGeoipAsnUrl}
        disabled={busy}
        error={errors.edgeLogGeoipAsnUrl}
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
        error={errors.builderConcurrency}
        onChange={(next) => patch({ builderConcurrency: next })}
      />

      <SettingsFooter>
        {draft !== null && (
          <span className="text-[11.5px] text-muted-foreground">
            {hasErrors ? "Fix the highlighted fields to save" : "Unsaved changes"}
          </span>
        )}
        <Button
          size="sm"
          disabled={draft === null || hasErrors || save.isPending}
          onClick={() => draft && !hasErrors && save.mutate({ organizationId, ...draft })}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}
