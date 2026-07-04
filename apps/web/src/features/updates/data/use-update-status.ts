/**
 * Shared read model for the platform updater — used by the banner, the header
 * button, the dialog, and the Platform card so they all agree. Backed by the
 * cached `system.updateSettings` row (populated by a check) + `system.version`.
 *
 * `retry: false`: these need `platform:read`, so a plain member gets a 403 — we
 * let it fail once and treat the whole feature as hidden rather than hammering.
 */
import { useMutation, useQuery } from "@tanstack/react-query";

import { orpc, queryClient } from "@/shared/server/orpc";

export interface UpdateStatus {
  current: string;
  dryRun: boolean;
  /** A newer version is cached as available. */
  available: boolean;
  latest: string | null;
  notes: string | null;
  url: string | null;
  simulated: boolean;
  dismissed: string | null;
  /** available AND not dismissed — drives the loud banner. */
  bannerVisible: boolean;
  lastCheckedAt: string | null;
  isLoading: boolean;
}

type SettingsData = Awaited<ReturnType<typeof orpc.system.updateSettings.get.call>>;

interface SettingsParts {
  latest: string | null;
  notes: string | null;
  url: string | null;
  dismissed: string | null;
  lastCheckedAt: string | null;
}

function fromSettings(s: SettingsData | undefined): SettingsParts {
  if (!s) return { latest: null, notes: null, url: null, dismissed: null, lastCheckedAt: null };
  return {
    latest: s.availableVersion ?? null,
    notes: s.availableReleaseNotes ?? null,
    url: s.availableReleaseUrl ?? null,
    dismissed: s.dismissedVersion ?? null,
    lastCheckedAt: s.lastCheckedAt ?? null,
  };
}

export function useUpdateStatus(): UpdateStatus {
  const version = useQuery({ ...orpc.system.version.queryOptions(), retry: false });
  const settings = useQuery({ ...orpc.system.updateSettings.get.queryOptions(), retry: false });

  const parts = fromSettings(settings.data);
  const dryRun = version.data?.dryRun ?? true;
  const available = parts.latest !== null;

  return {
    current: version.data?.current ?? "…",
    dryRun,
    available,
    latest: parts.latest,
    notes: parts.notes,
    url: parts.url,
    // A cached available version with no release URL is the override (test) target.
    simulated: available && !parts.url && dryRun,
    dismissed: parts.dismissed,
    bannerVisible: available && parts.latest !== parts.dismissed,
    lastCheckedAt: parts.lastCheckedAt,
    isLoading: version.isLoading || settings.isLoading,
  };
}

function invalidateSettings() {
  return queryClient.invalidateQueries({
    queryKey: orpc.system.updateSettings.get.queryKey(),
  });
}

export function useCheckForUpdate() {
  return useMutation({
    ...orpc.system.checkForUpdate.mutationOptions(),
    onSuccess: () => void invalidateSettings(),
  });
}

export function useDismissUpdate() {
  return useMutation({
    ...orpc.system.updateSettings.save.mutationOptions(),
    onSuccess: () => void invalidateSettings(),
  });
}
