/** Field layout for the schedule editor. Form plumbing lives in `./schedule-form`. */
import { useLiveQuery } from "@tanstack/react-db";

import { terminalDatabasesCollection } from "@/features/terminal/data/targets";
import { ScrollArea } from "@/shared/components/ui/scroll-area";

import type { Destination } from "./data/destinations";

import { SelectField, TextField } from "./form-fields";
import { MultiSelectCombobox } from "./multi-combobox";
import { type ScheduleFormApi, cronFromPreset } from "./schedule-form";
import { ReliabilityFields, RetentionFields } from "./schedule-policy-fields";
import { Field, Segmented, destUri } from "./shared";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const HOUR_ITEMS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, "0")}:00 UTC`,
}));

const WEEKDAY_ITEMS = WEEKDAYS.map((label, value) => ({ value: String(value), label }));

const DOM_ITEMS = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: `Day ${i + 1}`,
}));

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
    <ScrollArea className="max-h-[70vh]" viewportClassName="max-h-[inherit]">
      <div className="flex flex-col gap-4 p-5">
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

        <CadenceFields form={form} />
        <RetentionFields form={form} />
        <ReliabilityFields form={form} />

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
          backup.failed / backup.overdue / backup.verify-failed platform events,
          and the Notifications matrix decides which channels receive them. */}
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          Alerts route via <span className="font-medium text-foreground/80">Notifications</span>
          {": "}subscribe a channel to <span className="font-mono">backup.failed</span>,{" "}
          <span className="font-mono">backup.overdue</span>, or{" "}
          <span className="font-mono">backup.verify-failed</span> to get paged.
        </p>
      </div>
    </ScrollArea>
  );
}

/** Cadence: preset-first with real time knobs; `custom` exposes raw cron. */
function CadenceFields({ form }: { form: ScheduleFormApi }) {
  const syncCron = () => {
    const v = form.state.values;
    if (v.preset === "custom") return;
    form.setFieldValue(
      "cron",
      cronFromPreset(v.preset, { atHour: v.atHour, weekday: v.weekday, dayOfMonth: v.dayOfMonth }),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">Runs</span>
      <form.Field name="preset">
        {(f) => (
          <Segmented
            value={f.state.value}
            onChange={(np) => {
              f.handleChange(np);
              // Recompute the compiled cron right away so the summary +
              // custom field always reflect the chosen preset.
              setTimeout(syncCron, 0);
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

      <form.Subscribe selector={(s) => s.values.preset}>
        {(preset) => (
          <>
            {preset !== "hourly" && preset !== "custom" && (
              <div className="grid grid-cols-2 gap-2.5">
                {preset === "weekly" && (
                  <form.Field name="weekday">
                    {(f) => (
                      <SelectField
                        label="On"
                        items={WEEKDAY_ITEMS}
                        value={String(f.state.value)}
                        onChange={(v) => {
                          f.handleChange(Number(v));
                          setTimeout(syncCron, 0);
                        }}
                      />
                    )}
                  </form.Field>
                )}
                {preset === "monthly" && (
                  <form.Field name="dayOfMonth">
                    {(f) => (
                      <SelectField
                        label="On"
                        items={DOM_ITEMS}
                        value={String(f.state.value)}
                        onChange={(v) => {
                          f.handleChange(Number(v));
                          setTimeout(syncCron, 0);
                        }}
                      />
                    )}
                  </form.Field>
                )}
                <form.Field name="atHour">
                  {(f) => (
                    <SelectField
                      label="At"
                      items={HOUR_ITEMS}
                      value={String(f.state.value)}
                      onChange={(v) => {
                        f.handleChange(Number(v));
                        setTimeout(syncCron, 0);
                      }}
                    />
                  )}
                </form.Field>
              </div>
            )}
            {preset === "custom" && (
              <form.Field name="cron">
                {(f) => (
                  <TextField
                    label="Cron expression (5-field, UTC; @daily-style nicknames work)"
                    value={f.state.value}
                    mono
                    onChange={f.handleChange}
                  />
                )}
              </form.Field>
            )}
          </>
        )}
      </form.Subscribe>
    </div>
  );
}
