// Step_Storage — volume size, backups, high availability.
// Change 3: backupsEnabled defaults to false (reflected via prop). Change 4: Tailwind conversion.
import type { AnyFieldApi } from "@tanstack/react-form";
import type { ServiceKindDef } from "@/features/projects/data/service-kinds";
import { SectionH, Field, Switch3, SettingRow } from "./form-primitives";

type StorageProps = {
  storageGbField: AnyFieldApi;
  backupsEnabledField: AnyFieldApi;
  backupRetentionField: AnyFieldApi;
  pitrField: AnyFieldApi;
  highAvailabilityField: AnyFieldApi;
  kind: ServiceKindDef;
};

export function StepStorage({
  storageGbField,
  backupsEnabledField,
  backupRetentionField,
  pitrField,
  highAvailabilityField,
  kind,
}: StorageProps) {
  const storageGb = storageGbField.state.value as number;
  const backupsEnabled = backupsEnabledField.state.value as boolean;
  const backupRetention = backupRetentionField.state.value as number;
  const pitr = pitrField.state.value as boolean;
  const highAvailability = highAvailabilityField.state.value as boolean;

  const isPostgres = kind.id === "postgres";
  const isMysql = kind.id === "mysql";
  const supportsPitr = isPostgres || isMysql;

  return (
    <>
      <SectionH
        title="Persistent storage"
        sub="Volume mounted at the data directory · backed by SSD"
      />
      <div className="card p-4 mt-3">
        <Field label={`Volume size · ${storageGb} GB`}>
          <input
            type="range"
            min="5"
            max="2000"
            step="5"
            value={storageGb}
            onChange={(e) => storageGbField.handleChange(+e.target.value)}
            className="w-full"
          />
          <div className="flex items-center gap-3 text-[11px] mt-1.5">
            <span className="text-muted-foreground">5 GB</span>
            <div className="flex-1" />
            <span className="text-muted-foreground font-mono">
              ~${(storageGb * 0.1).toFixed(2)}/mo
            </span>
            <span className="text-muted-foreground">2 TB</span>
          </div>
        </Field>
        <div className="h-[14px]" />
        <SettingRow
          label="Auto-grow volume"
          defaultOn
          sub="Add 10 GB when free space drops below 15%"
        />
        <SettingRow
          label="Encrypt at rest"
          defaultOn
          sub="LUKS · per-project KMS key"
        />
      </div>

      <div className="h-[18px]" />
      <SectionH title="Backups" />
      <div className="card p-4 mt-[10px]">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[13px] font-medium">Daily snapshots</div>
            <div className="text-muted-foreground text-xs">
              Snapshot taken at 03:00 UTC · stored in S3-compatible object storage
            </div>
          </div>
          <Switch3
            on={backupsEnabled}
            onChange={(v) => backupsEnabledField.handleChange(v)}
          />
        </div>
        {backupsEnabled && (
          <>
            <div className="h-[14px]" />
            <div className="grid grid-cols-2 gap-[10px]">
              <Field label={`Retention · ${backupRetention} days`}>
                <input
                  type="range"
                  min="1"
                  max="90"
                  value={backupRetention}
                  onChange={(e) => backupRetentionField.handleChange(+e.target.value)}
                  className="w-full"
                />
              </Field>
              <Field label="Backup window">
                <select className="input">
                  <option>03:00 – 04:00 UTC</option>
                  <option>11:00 – 12:00 UTC</option>
                  <option>17:00 – 18:00 UTC</option>
                </select>
              </Field>
            </div>
          </>
        )}
        {supportsPitr && (
          <>
            <div className="h-3" />
            <div className="flex items-center gap-3 py-[10px] border-t border-border">
              <div className="flex-1">
                <div className="text-[13px] font-medium">Point-in-time recovery (PITR)</div>
                <div className="text-muted-foreground text-[11px]">
                  Continuous WAL archiving · restore to any point in the last 7 days
                </div>
              </div>
              <Switch3
                on={pitr}
                onChange={(v) => pitrField.handleChange(v)}
              />
            </div>
          </>
        )}
      </div>

      <div className="h-[18px]" />
      <SectionH title="High availability" />
      <div className="card p-4 mt-[10px]">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[13px] font-medium">Standby replica</div>
            <div className="text-muted-foreground text-xs">
              Sync replica on a different node · failover in &lt; 30s
            </div>
          </div>
          <Switch3
            on={highAvailability}
            onChange={(v) => highAvailabilityField.handleChange(v)}
          />
        </div>
      </div>
    </>
  );
}
