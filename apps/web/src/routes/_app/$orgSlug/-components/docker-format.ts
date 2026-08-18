/**
 * Daemon-panel display helpers. The reference/byte formatters live in
 * `@otterdeploy/shared`: every surface that names an image must shorten and
 * size it identically, so this file keeps only what is specific to reading
 * the Docker daemon: relative timestamps in its two timestamp dialects, and
 * the state→tone vocabulary for its badges.
 */

import { ABSENT, formatBytes } from "@otterdeploy/shared/format";
import { DIGEST_ID, shortDigest } from "@otterdeploy/shared/image-ref";

export { formatBytes };
export { splitRef } from "@otterdeploy/shared/image-ref";

/** Strip a Docker `sha256:…`/long id down to the conventional 12 chars. */
export function shortId(id: string): string {
  return shortDigest(id, DIGEST_ID) ?? ABSENT;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function timeAgoMs(ms: number): string {
  // Some daemon resources report a missing/zero/garbage timestamp; guard so a
  // single bad row can't throw "value must be finite" out of Intl and crash
  // the whole route render.
  if (!Number.isFinite(ms)) return ABSENT;
  const diffSeconds = (ms - Date.now()) / 1000;
  const abs = Math.abs(diffSeconds);
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs || unit === "second") {
      return rtf.format(Math.round(diffSeconds / secs), unit);
    }
  }
  return "just now";
}

/** Docker `Created`/`createdAt` is a unix timestamp in seconds across all resources. */
export function timeAgoSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ABSENT;
  return timeAgoMs(seconds * 1000);
}

/** Swarm tasks report RFC3339 strings instead of unix seconds. */
export function timeAgoIso(iso: string | null): string {
  if (!iso) return ABSENT;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return ABSENT;
  return timeAgoMs(ms);
}

/** Semantic tone vocabulary for daemon state badges (State-Tint Rule). */
export type StateTone = "success" | "warning" | "info" | "destructive" | "muted";

/**
 * Container state → tone, per the design target: running=success,
 * restarting=warning, paused=info, exited/dead=destructive (the status string
 * carries the exit code), everything transitional muted. A running-but-
 * unhealthy container downgrades to warning: the health probe is the truth.
 */
export function containerTone(state: string, status?: string): StateTone {
  const s = state.toLowerCase();
  if (s === "running") {
    return status?.toLowerCase().includes("(unhealthy)") ? "warning" : "success";
  }
  if (s === "restarting") return "warning";
  if (s === "paused") return "info";
  if (s === "exited" || s === "dead") return "destructive";
  return "muted"; // created / removing / …
}

const UPTIME_UNITS: Array<[RegExp, string]> = [
  [/^seconds?$/, "s"],
  [/^minutes?$/, "m"],
  [/^hours?$/, "h"],
  [/^days?$/, "d"],
  [/^weeks?$/, "w"],
  [/^months?$/, "mo"],
  [/^years?$/, "y"],
];

/** "About an hour" → "1h", "3 days" → "3d". Null when the phrase is novel. */
function shortSpan(phrase: string): string | null {
  const m = /^(?:About )?(an?|\d+) (\w+)/i.exec(phrase);
  if (!m) return null;
  const n = /^an?$/i.test(m[1] ?? "") ? "1" : (m[1] ?? "");
  const unit = UPTIME_UNITS.find(([re]) => re.test(m[2] ?? ""))?.[1];
  return unit ? `${n}${unit}` : null;
}

/**
 * Compress the daemon's status line to chip length: "Up 21 minutes (healthy)"
 * → "21m · healthy", "Exited (137) 3 hours ago" → "exited (137) · 3h ago".
 * The healthy majority reads quiet; exceptions carry their detail. Falls back
 * to the raw status when the dialect is novel, honesty over brevity.
 */
export function compressContainerStatus(state: string, status: string): string {
  const s = state.toLowerCase();
  if (s === "running") {
    const up = shortSpan(status.replace(/^Up\s+/, ""));
    const health = /\(healthy\)/i.test(status)
      ? " · healthy"
      : /\(unhealthy\)/i.test(status)
        ? " · unhealthy"
        : /\(health: starting\)/i.test(status)
          ? " · starting"
          : "";
    return up ? `${up}${health}` : status;
  }
  if (s === "exited" || s === "dead") {
    const m = /^Exited \((\d+)\)\s*(.*)$/.exec(status);
    if (!m) return status;
    const ago = shortSpan(m[2] ?? "");
    return `exited (${m[1]})${ago ? ` · ${ago} ago` : ""}`;
  }
  return state || status;
}

/** Swarm task state → tone (running=ok, ready=info, preparing=warn, …). */
export function taskTone(state: string): StateTone {
  const s = state.toLowerCase();
  if (s === "running" || s === "complete") return "success";
  if (s === "failed" || s === "rejected" || s === "orphaned") return "destructive";
  if (s === "preparing" || s === "starting") return "warning";
  if (s === "shutdown" || s === "remove") return "muted";
  return "info"; // new / pending / assigned / accepted / ready
}
