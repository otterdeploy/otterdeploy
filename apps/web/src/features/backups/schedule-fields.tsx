/** Field layout for the schedule editor. Form plumbing lives in `./schedule-form`. */
import { useLiveQuery } from "@tanstack/react-db";

import { terminalDatabasesCollection } from "@/features/terminal/data/targets";

import type { Destination } from "./data/destinations";

import { NumberField, SelectField, TextField } from "./form-fields";
import { MultiSelectCombobox } from "./multi-combobox";
import { PRESET_CRON, type ScheduleFormApi } from "./schedule-form";
import { Field, Segmented, destUri } from "./shared";

export function ScheduleFields({
  form,
  editing,
  destinations,
}: {
  form: ScheduleFormApi;
  editing: boolean;
  destinations: Destination[];
}) {
  const { data: databases } = useLiveQuery((q) => q.from({ d: terminalDatabasesCollection }));
  const dbOptions = databases.map((d) => ({
    value: d.resourceId,
    label: d.name,
    tag: d.projectName,
    keywords: `${d.engine} ${d.projectSlug}`,
    mono: true,
  }));
  const destOptions = destinations.map((d) => ({
    value: d.id,
    label: d.name,
    tag: d.type,
    keywords: destUri(d),
  }));
  const encItems = [
    { label: "AES-256 GCM", value: "aes" },
    { label: "None (not recommended)", value: "none" },
  ];

  return (
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-auto p-5">
      <form.Field name="name">
        {(f) => <TextField label="Name" value={f.state.value} onChange={f.handleChange} />}
      </form.Field>

      <form.Field name="sources">
        {(f) => (
          <Field label="Databases to back up">
            <MultiSelectCombobox
              options={dbOptions}
              value={f.state.value}
              onChange={f.handleChange}
              placeholder="Select databases…"
              searchPlaceholder="Search databases or projects…"
              emptyText="No matching databases."
            />
          </Field>
        )}
      </form.Field>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Cron preset</span>
        <form.Field name="preset">
          {(f) => (
            <Segmented
              value={f.state.value}
              onChange={(np) => {
                f.handleChange(np);
                if (np !== "custom") form.setFieldValue("cron", PRESET_CRON[np]);
              }}
              options={[
                { id: "hourly", label: "Hourly" },
                { id: "daily", label: "Daily" },
                { id: "weekly", label: "Weekly" },
                { id: "monthly", label: "Monthly" },
                { id: "custom", label: "Custom" },
              ]}
            />
          )}
        </form.Field>
      </div>

      <form.Field name="cron">
        {(f) => (
          <TextField
            label="Cron expression"
            value={f.state.value}
            mono
            onChange={(v) => {
              f.handleChange(v);
              form.setFieldValue("preset", "custom");
            }}
          />
        )}
      </form.Field>

      <RetentionFields form={form} />

      <form.Field name="preHook">
        {(f) => (
          <TextField
            label="Pre-backup hook (optional, runs in the DB container)"
            value={f.state.value}
            onChange={f.handleChange}
            placeholder="psql -c 'CHECKPOINT'"
            mono
          />
        )}
      </form.Field>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <form.Field name="destinationIds">
          {(f) => (
            <Field label="Destinations">
              <MultiSelectCombobox
                options={destOptions}
                value={f.state.value}
                onChange={f.handleChange}
                placeholder="Select destinations…"
                searchPlaceholder="Search destinations…"
                emptyText="No destinations yet."
                disabled={editing}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="encryptionNone">
          {(f) => (
            <SelectField
              label="Encryption"
              items={encItems}
              value={f.state.value ? "none" : "aes"}
              onChange={(v) => f.handleChange(v === "none")}
              disabled={editing}
            />
          )}
        </form.Field>
      </div>

      {/* Failure alerting is org-wide, not per-schedule: the engine emits
          backup.failed / backup.succeeded platform events, and the
          Notifications matrix decides which channels receive them. */}
      <p className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Failure alerts route via{" "}
        <span className="font-medium text-foreground/80">Notifications</span>
        {" — "}subscribe a channel to the <span className="font-mono">backup.failed</span> event to
        get paged when a scheduled run fails.
      </p>
    </div>
  );
}

/** GFS retention tiers + age/storage caps. */
function RetentionFields({ form }: { form: ScheduleFormApi }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">Retention (keep newest per period)</span>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <form.Field name="keepDaily">
          {(f) => (
            <NumberField
              label="Daily"
              min={0}
              value={f.state.value}
              onChange={(v) => f.handleChange(Number(v))}
            />
          )}
        </form.Field>
        <form.Field name="keepWeekly">
          {(f) => (
            <NumberField
              label="Weekly"
              min={0}
              value={f.state.value}
              onChange={(v) => f.handleChange(Number(v))}
            />
          )}
        </form.Field>
        <form.Field name="keepMonthly">
          {(f) => (
            <NumberField
              label="Monthly"
              min={0}
              value={f.state.value}
              onChange={(v) => f.handleChange(Number(v))}
            />
          )}
        </form.Field>
        <form.Field name="keepYearly">
          {(f) => (
            <NumberField
              label="Yearly"
              min={0}
              value={f.state.value}
              onChange={(v) => f.handleChange(Number(v))}
            />
          )}
        </form.Field>
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
