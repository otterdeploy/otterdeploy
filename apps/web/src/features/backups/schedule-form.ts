/**
 * Form state for the schedule editor: typed values, defaults, the optimistic
 * create/update mutation, and the `useScheduleForm` hook. No JSX. The field
 * layout lives in `./schedule-fields`.
 *
 * Cadence is preset-first: hourly/daily/weekly/monthly presets carry real
 * time-of-day / weekday / day-of-month knobs and compile to cron; `custom`
 * exposes the raw expression (validated server-side by the same parser the
 * scheduler fires with, so a saved schedule always actually fires).
 */
import { ID_PREFIX, createId, idSchema } from "@otterdeploy/shared/id";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";

import type { Destination } from "./data/destinations";
import type { Schedule } from "./data/schedules";

import { schedulesCollection } from "./data/schedules";

export type CronPreset = "hourly" | "daily" | "weekly" | "monthly" | "custom";

export interface CronParts {
  /** UTC hour for daily/weekly/monthly presets. */
  atHour: number;
  /** 0 (Sunday) – 6, weekly preset. */
  weekday: number;
  /** 1 – 28, monthly preset (capped so it fires every month). */
  dayOfMonth: number;
}

export const DEFAULT_PARTS: CronParts = { atHour: 3, weekday: 0, dayOfMonth: 1 };

/** Compile a preset + its knobs into the cron the scheduler fires with. */
export function cronFromPreset(preset: Exclude<CronPreset, "custom">, parts: CronParts): string {
  switch (preset) {
    case "hourly":
      return "0 * * * *";
    case "daily":
      return `0 ${parts.atHour} * * *`;
    case "weekly":
      return `0 ${parts.atHour} * * ${parts.weekday}`;
    case "monthly":
      return `0 ${parts.atHour} ${parts.dayOfMonth} * *`;
  }
}

/** Recognize a stored cron as one of the presets (else `custom`). */
export function presetFromCron(cron: string): { preset: CronPreset; parts: CronParts } {
  const parts = { ...DEFAULT_PARTS };
  const trimmed = cron.trim();
  if (trimmed === "0 * * * *") return { preset: "hourly", parts };
  const daily = /^0 (\d{1,2}) \* \* \*$/.exec(trimmed);
  if (daily) return { preset: "daily", parts: { ...parts, atHour: Number(daily[1]) } };
  const weekly = /^0 (\d{1,2}) \* \* (\d)$/.exec(trimmed);
  if (weekly) {
    return {
      preset: "weekly",
      parts: { ...parts, atHour: Number(weekly[1]), weekday: Number(weekly[2]) },
    };
  }
  const monthly = /^0 (\d{1,2}) (\d{1,2}) \* \*$/.exec(trimmed);
  if (monthly) {
    return {
      preset: "monthly",
      parts: { ...parts, atHour: Number(monthly[1]), dayOfMonth: Number(monthly[2]) },
    };
  }
  return { preset: "custom", parts };
}

export interface ScheduleFormValues {
  name: string;
  sources: string[];
  preset: CronPreset;
  atHour: number;
  weekday: number;
  dayOfMonth: number;
  cron: string;
  keepLast: number;
  keepHourly: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  keepYearly: number;
  retentionDays: string;
  maxStorageGb: string;
  preHook: string;
  destinationIds: string[];
  encryptionNone: boolean;
  enabled: boolean;
  maxRetries: number;
  verifyAfterBackup: boolean;
  overdueAfterHours: string;
}

const NEW_SCHEDULE: ScheduleFormValues = {
  name: "New backup schedule",
  sources: [],
  preset: "daily",
  atHour: DEFAULT_PARTS.atHour,
  weekday: DEFAULT_PARTS.weekday,
  dayOfMonth: DEFAULT_PARTS.dayOfMonth,
  cron: cronFromPreset("daily", DEFAULT_PARTS),
  keepLast: 0,
  keepHourly: 0,
  keepDaily: 14,
  keepWeekly: 4,
  keepMonthly: 6,
  keepYearly: 0,
  retentionDays: "",
  maxStorageGb: "",
  preHook: "",
  destinationIds: [],
  encryptionNone: false,
  enabled: true,
  maxRetries: 1,
  verifyAfterBackup: false,
  overdueAfterHours: "",
};

/**
 * Which destination a brand-new schedule starts with.
 *
 * Prefers the platform-managed local one: it always exists and needs no setup,
 * which is the whole point of it. Creating a working schedule should not
 * require configuring storage first. Falls back to any other enabled
 * destination, and never pre-selects a `disabled` one, since that would hand
 * the operator a schedule that silently writes nowhere.
 */
function defaultDestinationIds(destinations: Destination[]): string[] {
  const enabled = destinations.filter((d) => d.status !== "disabled");
  const preferred = enabled.find((d) => d.managed) ?? enabled[0];
  return preferred ? [preferred.id] : [];
}

function scheduleDefaults(
  initial: Schedule | null,
  destinations: Destination[],
): ScheduleFormValues {
  if (!initial)
    return {
      ...NEW_SCHEDULE,
      destinationIds: defaultDestinationIds(destinations),
    };
  const { preset, parts } = presetFromCron(initial.cron);
  return {
    name: initial.name,
    sources: initial.sources,
    preset,
    atHour: parts.atHour,
    weekday: parts.weekday,
    dayOfMonth: parts.dayOfMonth,
    cron: initial.cron,
    keepLast: initial.keepLast,
    keepHourly: initial.keepHourly,
    keepDaily: initial.keepDaily,
    keepWeekly: initial.keepWeekly,
    keepMonthly: initial.keepMonthly,
    keepYearly: initial.keepYearly,
    retentionDays: initial.retentionDays != null ? String(initial.retentionDays) : "",
    maxStorageGb: initial.maxStorageGb != null ? String(initial.maxStorageGb) : "",
    preHook: initial.preHook ?? "",
    destinationIds: initial.destinationIds,
    encryptionNone: initial.encryption === "none",
    enabled: initial.enabled,
    maxRetries: initial.maxRetries,
    verifyAfterBackup: initial.verifyAfterBackup,
    overdueAfterHours: initial.overdueAfterHours != null ? String(initial.overdueAfterHours) : "",
  };
}

/** Build the optimistic create/update mutation from the form values. */
function saveSchedule(
  initial: Schedule | null,
  organizationId: string,
  value: ScheduleFormValues,
  destinations: Destination[],
) {
  const sources = value.sources;
  const retentionDays = value.retentionDays.trim()
    ? Math.max(1, Number(value.retentionDays))
    : null;
  const maxStorageGb = value.maxStorageGb.trim() ? Math.max(1, Number(value.maxStorageGb)) : null;
  const overdueAfterHours = value.overdueAfterHours.trim()
    ? Math.max(1, Number(value.overdueAfterHours))
    : null;
  const preHook = value.preHook.trim() || null;
  const cron =
    value.preset === "custom"
      ? value.cron.trim()
      : cronFromPreset(value.preset, {
          atHour: value.atHour,
          weekday: value.weekday,
          dayOfMonth: value.dayOfMonth,
        });

  if (initial) {
    return schedulesCollection.update(initial.id, (draft) => {
      draft.name = value.name.trim();
      draft.sources = sources;
      draft.cron = cron;
      draft.keepLast = value.keepLast;
      draft.keepHourly = value.keepHourly;
      draft.keepDaily = value.keepDaily;
      draft.keepWeekly = value.keepWeekly;
      draft.keepMonthly = value.keepMonthly;
      draft.keepYearly = value.keepYearly;
      draft.retentionDays = retentionDays;
      draft.maxStorageGb = maxStorageGb;
      draft.preHook = preHook;
      draft.enabled = value.enabled;
      draft.maxRetries = value.maxRetries;
      draft.verifyAfterBackup = value.verifyAfterBackup;
      draft.overdueAfterHours = overdueAfterHours;
    });
  }
  return schedulesCollection.insert({
    // Temp optimistic id (a refetch swaps in the server's row): minted with
    // the real bsch_ prefix so it satisfies the branded id without a cast.
    id: createId(ID_PREFIX.backupSchedule),
    organizationId,
    projectId: null,
    name: value.name.trim(),
    sources,
    cron,
    keepLast: value.keepLast,
    keepHourly: value.keepHourly,
    keepDaily: value.keepDaily,
    keepWeekly: value.keepWeekly,
    keepMonthly: value.keepMonthly,
    keepYearly: value.keepYearly,
    retentionDays,
    maxStorageGb,
    preHook,
    // The picker only ever offers real destination rows, so each id parses;
    // parsing (not casting) keeps a corrupted form value from reaching the API.
    destinationIds: value.destinationIds.map((id) => idSchema.backupDestination.parse(id)),
    encryption: value.encryptionNone ? "none" : "aes-256-gcm",
    enabled: value.enabled,
    maxRetries: value.maxRetries,
    verifyAfterBackup: value.verifyAfterBackup,
    overdueAfterHours,
    overdueNotifiedAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    destinationNames: value.destinationIds
      .map((id) => destinations.find((d) => d.id === id)?.name)
      .filter((n): n is string => Boolean(n)),
    // Freshly created. The server resolves real source health on refetch.
    missingSources: [],
  });
}

export function useScheduleForm({
  initial,
  organizationId,
  destinations,
  onClose,
  presetSources,
}: {
  initial: Schedule | null;
  organizationId: string;
  destinations: Destination[];
  onClose: () => void;
  /** Pre-seeded sources for a NEW schedule; ignored when editing. */
  presetSources?: string[];
}) {
  const editing = initial !== null;
  const defaults = scheduleDefaults(initial, destinations);
  return useForm({
    defaultValues:
      !editing && presetSources && presetSources.length > 0
        ? { ...defaults, sources: presetSources }
        : defaults,
    onSubmit: ({ value }) => {
      const tx = saveSchedule(initial, organizationId, value, destinations);
      onClose();
      tx.isPersisted.promise
        .then(() => toast.success(editing ? "Schedule updated" : "Schedule created"))
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Couldn't save schedule"),
        );
    },
  });
}

export type ScheduleFormApi = ReturnType<typeof useScheduleForm>;
