/**
 * "Could I actually recover this install right now?" — the control-plane
 * backup/DR readiness card (od-5j8.13). Distinct from everything else on
 * this page: those back up ORG resources (databases/volumes); this backs up
 * the control plane ITSELF (its own Postgres, data dir, Caddy state) via a
 * host script (scripts/control-plane-backup.sh), not a BullMQ job — see
 * docs/designs/control-plane-disaster-recovery.md. Install-admin only.
 */
import type { controlPlaneReadinessSchema } from "@otterdeploy/api/routers/backups/control-plane-contract";
import type { z } from "zod";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { SettingsSection } from "@/shared/components/settings-section";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { Destination } from "./data/destinations";
import { RecoveryKeyDialog } from "./control-plane-recovery-key-dialog";

type ReadinessView = z.infer<typeof controlPlaneReadinessSchema>;

const LEVEL_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  ready: { label: "Ready", variant: "default" },
  degraded: { label: "Degraded", variant: "secondary" },
  not_ready: { label: "Not ready", variant: "destructive" },
};

function relativeHours(hours: number | null): string {
  if (hours == null) return "never";
  if (hours < 1) return "less than an hour ago";
  const whole = Math.floor(hours);
  if (whole < 48) return `${whole}h ago`;
  return `${Math.floor(whole / 24)}d ago`;
}

function ReadinessHeader({
  view,
  loading,
  onEnabledChange,
  pending,
}: {
  view: ReadinessView | undefined;
  loading: boolean;
  onEnabledChange: (enabled: boolean) => void;
  pending: boolean;
}) {
  const badge = view ? (LEVEL_BADGE[view.level] ?? LEVEL_BADGE.not_ready) : undefined;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {loading ? (
          <span className="text-[12.5px] text-muted-foreground">Checking…</span>
        ) : badge ? (
          <Badge variant={badge.variant}>{badge.label}</Badge>
        ) : null}
        {view && (
          <span className="text-[12.5px] text-muted-foreground">
            last successful backup: {relativeHours(view.lastBackupAgeHours)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] text-muted-foreground">Enabled</span>
        <Switch
          size="sm"
          checked={view?.backupEnabled ?? false}
          disabled={!view || pending}
          onCheckedChange={onEnabledChange}
        />
      </div>
    </div>
  );
}

function ReadinessReasons({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-md border border-border/60 bg-muted/30 p-3 text-[12.5px] text-muted-foreground">
      {reasons.map((reason) => (
        <li key={reason}>· {reason}</li>
      ))}
    </ul>
  );
}

function DestinationPicker({
  destinations,
  selectedId,
  disabled,
  onSelect,
}: {
  destinations: Destination[];
  selectedId: string | null | undefined;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] text-muted-foreground">Off-host destination</span>
      <Select
        value={selectedId ?? undefined}
        onValueChange={(id) => typeof id === "string" && onSelect(id)}
        items={destinations.map((d) => ({ label: d.name, value: d.id }))}
        disabled={destinations.length === 0 || disabled}
      >
        <SelectTrigger className="w-56 text-[12.5px]">
          <SelectValue
            placeholder={destinations.length === 0 ? "No S3 destination configured" : "Select a destination"}
          />
        </SelectTrigger>
        <SelectContent>
          {destinations.map((d) => (
            <SelectItem key={d.id} value={d.id} className="text-[12.5px]">
              {d.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-[11px] text-muted-foreground/80">
        Reuses an S3-compatible destination from above — off-host by construction. Set object
        lock/versioning on the bucket for immutability (not enforced by the app).
      </span>
    </div>
  );
}

function RecoveryKeySummary({
  fingerprint,
  exportedAt,
  onGenerate,
}: {
  fingerprint: string | null;
  exportedAt: Date | null;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] text-muted-foreground">Recovery key</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] text-muted-foreground">
          {fingerprint ?? "none generated"}
        </span>
        {fingerprint && !exportedAt && <Badge variant="destructive">not exported</Badge>}
      </div>
      <Button variant="outline" size="sm" className="self-start" onClick={onGenerate}>
        {fingerprint ? "Rotate recovery key" : "Generate recovery key"}
      </Button>
    </div>
  );
}

export function ControlPlaneRecoveryCard({ destinations }: { destinations: Destination[] }) {
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);

  const readinessKey = orpc.backups.controlPlane.readiness.queryKey({ input: {} });
  const readiness = useQuery(orpc.backups.controlPlane.readiness.queryOptions({ input: {} }));

  const configure = useMutation({
    ...orpc.backups.controlPlane.configure.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: readinessKey });
    },
    onError: (err) => toast.error(err.message ?? "Failed to update control-plane backup config"),
  });

  const view = readiness.data;
  const s3Destinations = destinations.filter((d) => d.type === "s3");

  return (
    <SettingsSection
      title="Control-plane recovery"
      description="Whole-install disaster recovery — the control plane's own Postgres, data directory, and Caddy state, encrypted with a recovery key independent of this server. Distinct from the database/volume backups above."
    >
      <div className="flex flex-col gap-4 p-4">
        <ReadinessHeader
          view={view}
          loading={readiness.isLoading}
          pending={configure.isPending}
          onEnabledChange={(enabled) =>
            configure.mutate({ destinationId: view?.destinationId ?? null, enabled })
          }
        />

        <ReadinessReasons reasons={view?.reasons ?? []} />

        <div className="flex flex-wrap items-end gap-3">
          <DestinationPicker
            destinations={s3Destinations}
            selectedId={view?.destinationId}
            disabled={configure.isPending}
            onSelect={(destinationId) =>
              configure.mutate({ destinationId, enabled: view?.backupEnabled ?? false })
            }
          />
          <RecoveryKeySummary
            fingerprint={view?.recoveryKeyFingerprint ?? null}
            exportedAt={view?.recoveryKeyExportedAt ?? null}
            onGenerate={() => setKeyDialogOpen(true)}
          />
        </div>
      </div>

      <RecoveryKeyDialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen} />
    </SettingsSection>
  );
}
