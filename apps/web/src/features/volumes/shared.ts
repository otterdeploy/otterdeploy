/**
 * Shared types + formatters for the Volumes feature. Row types are inferred
 * from the oRPC client so the UI can't drift from the contract.
 */
import { relativeSeconds } from "@/shared/lib/time";
import { client } from "@/shared/server/orpc";

export type VolumesListOutput = Awaited<ReturnType<typeof client.volumes.list>>;
export type VolumeRow = VolumesListOutput["volumes"][number];
export type VolumeAttachment = VolumeRow["attachedTo"][number];

/** -1 (daemon didn't report usage) renders as unknown, not as a fake zero. */
export function fmtBytes(n: number): string {
  if (n < 0) return "–";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / 1024 ** i;
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/** Unix seconds → relative time; guards non-finite/zero daemon timestamps. */
export function timeAgoSeconds(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "–";
  return relativeSeconds(seconds - Date.now() / 1000);
}
