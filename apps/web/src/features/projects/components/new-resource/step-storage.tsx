// Step_Storage — volume size, backups, high availability.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 2257-2394.
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
      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <Field label={`Volume size · ${storageGb} GB`}>
          <input
            type="range"
            min="5"
            max="2000"
            step="5"
            value={storageGb}
            onChange={(e) => storageGbField.handleChange(+e.target.value)}
            style={{ width: "100%" }}
          />
          <div className="os-row os-gap-3" style={{ fontSize: 11, marginTop: 6 }}>
            <span className="os-muted">5 GB</span>
            <div style={{ flex: 1 }} />
            <span className="os-muted os-mono">
              ~${(storageGb * 0.1).toFixed(2)}/mo
            </span>
            <span className="os-muted">2 TB</span>
          </div>
        </Field>
        <div style={{ height: 14 }} />
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

      <div style={{ height: 18 }} />
      <SectionH title="Backups" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div className="os-row os-gap-3">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Daily snapshots</div>
            <div className="os-muted" style={{ fontSize: 12 }}>
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
            <div style={{ height: 14 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label={`Retention · ${backupRetention} days`}>
                <input
                  type="range"
                  min="1"
                  max="90"
                  value={backupRetention}
                  onChange={(e) => backupRetentionField.handleChange(+e.target.value)}
                  style={{ width: "100%" }}
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
            <div style={{ height: 12 }} />
            <div className="os-row os-gap-3" style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Point-in-time recovery (PITR)</div>
                <div className="os-muted" style={{ fontSize: 11 }}>
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

      <div style={{ height: 18 }} />
      <SectionH title="High availability" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div className="os-row os-gap-3">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Standby replica</div>
            <div className="os-muted" style={{ fontSize: 12 }}>
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
