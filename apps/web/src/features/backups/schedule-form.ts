/**
 * Form state for the schedule editor: typed values, defaults, the optimistic
 * create/update mutation, and the `useScheduleForm` hook. No JSX. The field
 * layout lives in `./schedule-fields`.
 */
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";

import type { Destination } from "./data/destinations";
import type { Schedule } from "./data/schedules";

import { schedulesCollection } from "./data/schedules";

export type CronPreset = "hourly" | "daily" | "weekly" | "monthly" | "custom";

export const PRESET_CRON: Record<Exclude<CronPreset, "custom">, string> = {
  hourly: "0 * * * *",
  daily: "0 3 * * *",
  weekly: "0 4 * * 0",
  monthly: "0 2 1 * *",
};

function presetFromCron(cron: string): CronPreset {
  const entries = Object.entries(PRESET_CRON) as [Exclude<CronPreset, "custom">, string][];
  return entries.find(([, c]) => c === cron)?.[0] ?? "custom";
}

export interface ScheduleFormValues {
  name: string;
  sources: string[];
  preset: CronPreset;
  cron: string;
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
}

const NEW_SCHEDULE: ScheduleFormValues = {
  name: "New backup schedule",
  sources: [],
  preset: "daily",
  cron: PRESET_CRON.daily,
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
};

/**
 * Which destination a brand-new schedule starts with.
 *
 * Prefers the platform-managed local one: it always exists and needs no setup,
 * which is the whole point of it. Creating a working schedule should not
 * require configuring storage first. Falls back to any other enabled
 * destination, and never pre-selects a `disabled` one, since that would hand
 * the operator a schedule that silently writes nowhere.
 *
 * Chosen explicitly rather than taking `destinations[0]` so the default doesn't
 * silently change if the list's sort order is ever revisited.
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
  return {
    name: initial.name,
    sources: initial.sources,
    preset: presetFromCron(initial.cron),
    cron: initial.cron,
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
  const preHook = value.preHook.trim() || null;

  if (initial) {
    return schedulesCollection.update(initial.id, (draft) => {
      draft.name = value.name.trim();
      draft.sources = sources;
      draft.cron = value.cron.trim();
      draft.keepDaily = value.keepDaily;
      draft.keepWeekly = value.keepWeekly;
      draft.keepMonthly = value.keepMonthly;
      draft.keepYearly = value.keepYearly;
      draft.retentionDays = retentionDays;
      draft.maxStorageGb = maxStorageGb;
      draft.preHook = preHook;
      draft.enabled = value.enabled;
    });
  }
  return schedulesCollection.insert({
    id: crypto.randomUUID() as Schedule["id"],
    organizationId,
    projectId: null,
    name: value.name.trim(),
    sources,
    cron: value.cron.trim(),
    keepDaily: value.keepDaily,
    keepWeekly: value.keepWeekly,
    keepMonthly: value.keepMonthly,
    keepYearly: value.keepYearly,
    retentionDays,
    maxStorageGb,
    preHook,
    destinationIds: value.destinationIds as Schedule["destinationIds"],
    encryption: value.encryptionNone ? "none" : "aes-256-gcm",
    enabled: value.enabled,
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
}: {
  initial: Schedule | null;
  organizationId: string;
  destinations: Destination[];
  onClose: () => void;
}) {
  const editing = initial !== null;
  return useForm({
    defaultValues: scheduleDefaults(initial, destinations),
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
