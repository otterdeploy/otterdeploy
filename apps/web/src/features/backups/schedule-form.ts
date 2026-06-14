/**
 * Form state for the schedule editor: typed values, defaults, the optimistic
 * create/update mutation, and the `useScheduleForm` hook. No JSX — the field
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
  const entries = Object.entries(PRESET_CRON) as [
    Exclude<CronPreset, "custom">,
    string,
  ][];
  return entries.find(([, c]) => c === cron)?.[0] ?? "custom";
}

export interface ScheduleFormValues {
  name: string;
  sourcesText: string;
  preset: CronPreset;
  cron: string;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  keepYearly: number;
  retentionDays: string;
  maxStorageGb: string;
  preHook: string;
  destinationId: string;
  encryptionNone: boolean;
  enabled: boolean;
}

const NEW_SCHEDULE: ScheduleFormValues = {
  name: "New backup schedule",
  sourcesText: "",
  preset: "daily",
  cron: PRESET_CRON.daily,
  keepDaily: 14,
  keepWeekly: 4,
  keepMonthly: 6,
  keepYearly: 0,
  retentionDays: "",
  maxStorageGb: "",
  preHook: "",
  destinationId: "",
  encryptionNone: false,
  enabled: true,
};

function scheduleDefaults(
  initial: Schedule | null,
  destinations: Destination[],
): ScheduleFormValues {
  if (!initial)
    return { ...NEW_SCHEDULE, destinationId: destinations[0]?.id ?? "" };
  return {
    name: initial.name,
    sourcesText: initial.sources.join(", "),
    preset: presetFromCron(initial.cron),
    cron: initial.cron,
    keepDaily: initial.keepDaily,
    keepWeekly: initial.keepWeekly,
    keepMonthly: initial.keepMonthly,
    keepYearly: initial.keepYearly,
    retentionDays:
      initial.retentionDays != null ? String(initial.retentionDays) : "",
    maxStorageGb:
      initial.maxStorageGb != null ? String(initial.maxStorageGb) : "",
    preHook: initial.preHook ?? "",
    destinationId: initial.destinationId,
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
  const sources = value.sourcesText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const retentionDays = value.retentionDays.trim()
    ? Math.max(1, Number(value.retentionDays))
    : null;
  const maxStorageGb = value.maxStorageGb.trim()
    ? Math.max(1, Number(value.maxStorageGb))
    : null;
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
    destinationId: value.destinationId as Schedule["destinationId"],
    encryption: value.encryptionNone ? "none" : "aes-256-gcm",
    pitr: false,
    enabled: value.enabled,
    notifyChannel: null,
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    destinationName:
      destinations.find((d) => d.id === value.destinationId)?.name ?? null,
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
        .then(() =>
          toast.success(editing ? "Schedule updated" : "Schedule created"),
        )
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Couldn't save schedule"),
        );
    },
  });
}

export type ScheduleFormApi = ReturnType<typeof useScheduleForm>;
