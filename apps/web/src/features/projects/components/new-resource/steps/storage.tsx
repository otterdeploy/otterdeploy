import { useStore } from "@tanstack/react-form";

import type { ServiceKind } from "@/features/projects/data/service-kinds";
import { Card } from "@/shared/components/ui/card";
import { Switch } from "@/shared/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Slider } from "@/shared/components/ui/slider";

import { traitsFor } from "../engine-traits";
import { Field, SectionHeader, SettingRow } from "../form-primitives";
import { useFormContext } from "../form-context";

interface StepStorageProps {
  kind: ServiceKind;
}

export function StepStorage({ kind }: StepStorageProps) {
  const form = useFormContext();
  const storageGb = useStore(form.store, (s) => s.values.storageGb as number);
  const backupsEnabled = useStore(form.store, (s) => s.values.backupsEnabled as boolean);
  const backupRetention = useStore(form.store, (s) => s.values.backupRetention as number);
  const pitr = useStore(form.store, (s) => s.values.pitr as boolean);
  const highAvailability = useStore(form.store, (s) => s.values.highAvailability as boolean);

  const traits = traitsFor(kind.id);
  const supportsPitr = traits.supportsPitr;
  const supportsHa = traits.supportsHaReplica;

  return (
    <>
      <SectionHeader
        title="Persistent storage"
        sub="Volume mounted at the data directory · backed by SSD"
      />
      <Card className="mt-3 p-4">
        <Field label={`Volume size · ${storageGb} GB`}>
          <Slider
            min={5}
            max={2000}
            step={5}
            value={[storageGb]}
            onValueChange={(v) => {
              const next = Array.isArray(v) ? v[0] : v;
              if (typeof next === "number") form.setFieldValue("storageGb", next);
            }}
          />
          <div className="mt-1.5 flex items-center gap-3 text-[11px]">
            <span className="text-muted-foreground">5 GB</span>
            <div className="flex-1" />
            <span className="text-muted-foreground">2 TB</span>
          </div>
        </Field>
        <div className="mt-3.5">
          <SettingRow
            label="Auto-grow volume"
            defaultOn
            sub="Add 10 GB when free space drops below 15%"
          />
          <SettingRow label="Encrypt at rest" defaultOn sub="LUKS · per-project KMS key" />
        </div>
      </Card>

      <div className="mt-4.5">
        <SectionHeader title="Backups" />
      </div>
      <Card className="mt-2.5 p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[13px] font-medium">Daily snapshots</div>
            <div className="text-xs text-muted-foreground">
              Snapshot taken at 03:00 UTC · stored in S3-compatible object storage
            </div>
          </div>
          <Switch
            checked={backupsEnabled}
            onCheckedChange={(v) => form.setFieldValue("backupsEnabled", v)}
          />
        </div>

        {backupsEnabled && (
          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            <Field label={`Retention · ${backupRetention} days`}>
              <Slider
                min={1}
                max={90}
                value={[backupRetention]}
                onValueChange={(v) => {
                  const next = Array.isArray(v) ? v[0] : v;
                  if (typeof next === "number") form.setFieldValue("backupRetention", next);
                }}
              />
            </Field>
            <Field label="Backup window">
              <Select
                defaultValue="03"
                items={[
                  { label: "03:00 - 04:00 UTC", value: "03" },
                  { label: "11:00 - 12:00 UTC", value: "11" },
                  { label: "17:00 - 18:00 UTC", value: "17" },
                ]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="03">03:00 - 04:00 UTC</SelectItem>
                  <SelectItem value="11">11:00 - 12:00 UTC</SelectItem>
                  <SelectItem value="17">17:00 - 18:00 UTC</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}

        {supportsPitr && (
          <div className="mt-3 flex items-center gap-3 border-t border-border pt-2.5">
            <div className="flex-1">
              <div className="text-[13px] font-medium">Point-in-time recovery (PITR)</div>
              <div className="text-[11px] text-muted-foreground">
                Continuous transaction-log archiving · restore to any point in the last 7 days
              </div>
            </div>
            <Switch checked={pitr} onCheckedChange={(v) => form.setFieldValue("pitr", v)} />
          </div>
        )}
      </Card>

      {supportsHa && (
        <>
          <div className="mt-4.5">
            <SectionHeader title="High availability" />
          </div>
          <Card className="mt-2.5 p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-[13px] font-medium">Standby replica</div>
                <div className="text-xs text-muted-foreground">
                  Sync replica on a different node · failover in &lt; 30s
                </div>
              </div>
              <Switch
                checked={highAvailability}
                onCheckedChange={(v) => form.setFieldValue("highAvailability", v)}
              />
            </div>
          </Card>
        </>
      )}
    </>
  );
}
