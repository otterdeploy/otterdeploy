/**
 * Policy halves of the schedule editor: GFS retention tiers + caps, and the
 * reliability knobs (bounded retry, restore-proving verification, overdue
 * alerting). Split from schedule-fields.tsx for the line budget.
 */
import { Switch } from "@/shared/components/ui/switch";

import type { ScheduleFormApi } from "./schedule-form";

import { NumberField, SelectField } from "./form-fields";

const RETRY_ITEMS = [
  { value: "0", label: "Don't retry" },
  { value: "1", label: "Retry once" },
  { value: "2", label: "Retry twice" },
  { value: "3", label: "Retry 3 times" },
];

/** GFS retention tiers + age/storage caps. */
export function RetentionFields({ form }: { form: ScheduleFormApi }) {
  const tier = (
    name: "keepLast" | "keepHourly" | "keepDaily" | "keepWeekly" | "keepMonthly" | "keepYearly",
    label: string,
  ) => (
    <form.Field name={name}>
      {(f) => (
        <NumberField
          label={label}
          min={0}
          value={f.state.value}
          onChange={(v) => f.handleChange(Number(v))}
        />
      )}
    </form.Field>
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">Retention (keep newest per period)</span>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
        {tier("keepLast", "Last")}
        {tier("keepHourly", "Hourly")}
        {tier("keepDaily", "Daily")}
        {tier("keepWeekly", "Weekly")}
        {tier("keepMonthly", "Monthly")}
        {tier("keepYearly", "Yearly")}
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <form.Field name="retentionDays">
          {(f) => (
            <NumberField
              label="Max age (days, optional)"
              min={1}
              placeholder="none"
              value={f.state.value}
              onChange={f.handleChange}
            />
          )}
        </form.Field>
        <form.Field name="maxStorageGb">
          {(f) => (
            <NumberField
              label="Max storage (GB, optional)"
              min={1}
              placeholder="none"
              value={f.state.value}
              onChange={f.handleChange}
            />
          )}
        </form.Field>
      </div>
    </div>
  );
}

/** Reliability: bounded retry, restore-proving verification, overdue alert. */
export function ReliabilityFields({ form }: { form: ScheduleFormApi }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">Reliability</span>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <form.Field name="maxRetries">
          {(f) => (
            <SelectField
              label="If a run fails"
              items={RETRY_ITEMS}
              value={String(f.state.value)}
              onChange={(v) => f.handleChange(Number(v))}
            />
          )}
        </form.Field>
        <form.Field name="overdueAfterHours">
          {(f) => (
            <NumberField
              label="Alert when no success for (hours)"
              min={1}
              placeholder="auto (2× cadence)"
              value={f.state.value}
              onChange={f.handleChange}
            />
          )}
        </form.Field>
      </div>
      <form.Field name="verifyAfterBackup">
        {(f) => (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
            <span className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">Verify each backup by restoring it</span>
              <span className="text-[11px] text-muted-foreground">
                After every successful run, restore the snapshot into a throwaway container and
                check tables + size. Postgres only for now.
              </span>
            </span>
            <Switch
              checked={f.state.value}
              onCheckedChange={f.handleChange}
              aria-label="Verify each backup by restoring it"
            />
          </div>
        )}
      </form.Field>
    </div>
  );
}
