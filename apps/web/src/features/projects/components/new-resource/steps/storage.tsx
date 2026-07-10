/**
 * Storage step (database kinds only). Deliberately informational: the
 * provisioner creates a plain named Docker volume mounted at the engine's
 * data directory — it supports no volume sizing, quota, auto-grow,
 * encryption-at-rest, backup policy, PITR, or standby replicas today
 * (see `packages/api/src/swarm/database.ts` ProvisionSwarmDatabaseInput and
 * the manifest `databaseSchema`). The old decorative controls for those
 * options wrote to local state (or to form fields the manifest dropped),
 * which violated "honest about system state" — so they were removed rather
 * than shipped as fake toggles. Backups ARE real, but they're schedules
 * created against the live resource after deploy, on the Backups page.
 */

import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { Card } from "@/shared/components/ui/card";

import { traitsFor } from "../engine-traits";
import { SectionHeader } from "../form-primitives";

interface StepStorageProps {
  kind: ServiceKind;
}

export function StepStorage({ kind }: StepStorageProps) {
  const mountTarget = traitsFor(kind.id).mountTarget;

  return (
    <>
      <SectionHeader
        title="Persistent storage"
        sub="Provisioned automatically when this database deploys"
      />
      <Card className="mt-3 gap-0 p-4">
        <InfoRow
          label="Volume"
          value={
            <>
              Named Docker volume mounted at{" "}
              <code className="font-mono text-foreground">{mountTarget}</code>
            </>
          }
        />
        <InfoRow label="Sizing" value="Grows with the data — no fixed size or quota is applied" />
        <InfoRow
          label="Data safety"
          value="The volume is kept if the database is removed or a create fails, so data is never destroyed silently"
          last
        />
      </Card>

      <div className="mt-4.5">
        <SectionHeader title="Backups" />
      </div>
      <Card className="mt-2.5 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Backup schedules (cron cadence, retention, destinations) are configured against the
          running database after it deploys — open the{" "}
          <span className="font-medium text-foreground">Backups</span> page once this resource is
          live.
        </p>
      </Card>
    </>
  );
}

function InfoRow({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 py-2 text-xs ${last ? "" : "border-b border-border/60"}`}
    >
      <span className="w-20 shrink-0 pt-px text-[11px] text-muted-foreground">{label}</span>
      <span className="flex-1 leading-relaxed text-foreground/90">{value}</span>
    </div>
  );
}
