/**
 * Migration card (od-b34a): detect other deploy platforms running on this
 * host and import their workloads. Detection and planning are on-demand
 * (never ambient — they exec against the host's docker daemon), and the
 * plan preview carries env KEYS only; values go straight from the source
 * platform's DB into encrypted rows server-side.
 */

import { useState } from "react";

import { ArrowDataTransferHorizontalIcon } from "@hugeicons/core-free-icons";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsFooter, SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { orpc } from "@/shared/server/orpc";

type Detected = Awaited<ReturnType<typeof orpc.migrate.detect.call>>[number];
type Plan = Awaited<ReturnType<typeof orpc.migrate.coolifyPlan.call>>;
type ImportOutcome = Awaited<ReturnType<typeof orpc.migrate.coolifyApply.call>>;

const PLATFORM_LABEL: Record<Detected["platform"], string> = {
  coolify: "Coolify",
  dokploy: "Dokploy",
  caprover: "CapRover",
};

function DetectedRows({ detected }: { detected: Detected[] }) {
  if (detected.length === 0) {
    return (
      <SettingsRow
        title="Nothing found"
        description="No other deploy platform is running on this host."
        control={null}
      />
    );
  }
  return (
    <>
      {detected.map((d) => (
        <SettingsRow
          key={d.platform}
          title={PLATFORM_LABEL[d.platform]}
          description={
            d.importSupported
              ? `Containers: ${d.containers.join(", ")}`
              : "Detected. Import support is coming soon."
          }
          control={
            <span className="flex items-center gap-2">
              {d.version && <Badge className="font-mono">{d.version}</Badge>}
              {!d.importSupported && <Badge variant="secondary">coming soon</Badge>}
            </span>
          }
        />
      ))}
    </>
  );
}

function PlanRow({ plan }: { plan: Plan }) {
  const services = plan.projects.reduce((n, p) => n + p.services.length, 0);
  const databases = plan.projects.reduce((n, p) => n + p.databases.length, 0);
  const summary = `${plan.projects.length} project(s), ${services} service(s), ${databases} database(s)`;
  return (
    <SettingsRow
      title="Import plan"
      description={plan.warnings[0] ? `${summary}. ${plan.warnings[0]}` : summary}
      control={
        <span className="text-[12.5px] text-muted-foreground">
          {plan.projects.map((p) => p.name).join(", ") || "nothing to import"}
        </span>
      }
    />
  );
}

function OutcomeRows({ outcome }: { outcome: ImportOutcome }) {
  return (
    <>
      {outcome.projects.map((p) => (
        <SettingsRow
          key={p.coolifyProject}
          title={p.coolifyProject}
          description={
            p.error ??
            `Imported as ${p.slug}: ${p.services} service(s), ${p.databases} database(s).${p.skipped.length > 0 ? ` Skipped: ${p.skipped.map((s) => s.name).join(", ")}.` : ""}`
          }
          control={
            p.error ? (
              <Badge variant="destructive">failed</Badge>
            ) : (
              <Badge variant="secondary">imported</Badge>
            )
          }
        />
      ))}
    </>
  );
}

const onErrorToast = (fallback: string) => (err: Error) => {
  toast.error(err.message || fallback);
};

/** One busy-aware action button; keeps the card body's branching flat. */
function ActionButton({
  busy,
  busyLabel,
  label,
  outline,
  onClick,
}: {
  busy: boolean;
  busyLabel: string;
  label: string;
  outline?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={outline ? "outline" : "default"}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? busyLabel : label}
    </Button>
  );
}

export function MigrationCard() {
  const [detected, setDetected] = useState<Detected[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const detect = useMutation({
    ...orpc.migrate.detect.mutationOptions(),
    onSuccess: (found) => {
      setDetected(found);
      setPlan(null);
      setOutcome(null);
    },
    onError: onErrorToast("Detection failed"),
  });

  const loadPlan = useMutation({
    ...orpc.migrate.coolifyPlan.mutationOptions(),
    onSuccess: setPlan,
    onError: onErrorToast("Could not read the Coolify install"),
  });

  const applyImport = useMutation({
    ...orpc.migrate.coolifyApply.mutationOptions(),
    onSuccess: (result) => {
      setOutcome(result);
      const failed = result.projects.filter((p) => p.error !== null).length;
      if (failed === 0) toast.success(`Imported ${result.projects.length} project(s).`);
      else toast.error(`${failed} of ${result.projects.length} project(s) failed to import.`);
    },
    onError: onErrorToast("Import failed"),
  });

  const coolify = detected?.find((d) => d.platform === "coolify") ?? null;
  const showPreview = coolify?.importSupported === true && plan === null;
  const showApply = plan !== null && plan.projects.length > 0 && outcome === null;

  return (
    <SettingsSection
      icon={ArrowDataTransferHorizontalIcon}
      title="Migration"
      description="Detect another deploy platform running on this host and import its projects."
    >
      {detected === null ? (
        <SettingsRow
          title="Scan this host"
          description="Looks for Coolify, Dokploy, or CapRover containers on the docker daemon this install manages."
          control={null}
        />
      ) : (
        <DetectedRows detected={detected} />
      )}
      {plan && <PlanRow plan={plan} />}
      {outcome && <OutcomeRows outcome={outcome} />}

      <SettingsFooter>
        <ActionButton
          busy={detect.isPending}
          busyLabel="Scanning…"
          label={detected === null ? "Scan this host" : "Rescan"}
          outline
          onClick={() => detect.mutate({})}
        />
        {showPreview && (
          <ActionButton
            busy={loadPlan.isPending}
            busyLabel="Reading Coolify…"
            label="Preview import"
            onClick={() => loadPlan.mutate({})}
          />
        )}
        {showApply && (
          <ActionButton
            busy={applyImport.isPending}
            busyLabel="Importing…"
            label={`Import ${plan.projects.length} project(s)`}
            onClick={() => applyImport.mutate({})}
          />
        )}
      </SettingsFooter>
    </SettingsSection>
  );
}
