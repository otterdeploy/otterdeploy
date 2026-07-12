/** Strip a Docker `sha256:…`/long id down to the conventional 12 chars. */
export function shortId(id: string): string {
  return id.replace(/^sha256:/, "").slice(0, 12) || "—";
}

/** Split an image ref into repo + tag on the final colon (registry ports keep their colon). */
export function splitRef(ref: string): { repo: string; tag: string } {
  const i = ref.lastIndexOf(":");
  if (i === -1) return { repo: ref, tag: "" };
  const tag = ref.slice(i + 1);
  if (tag.includes("/")) return { repo: ref, tag: "" };
  return { repo: ref.slice(0, i), tag };
}

export function formatBytes(n: number): string {
  if (n < 0) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(n) / Math.log(1024)),
    units.length - 1,
  );
  const v = n / 1024 ** i;
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
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
  if (!Number.isFinite(ms)) return "—";
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
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return timeAgoMs(seconds * 1000);
}

/** Swarm tasks report RFC3339 strings instead of unix seconds. */
export function timeAgoIso(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return timeAgoMs(ms);
}

/** Semantic tone vocabulary for daemon state badges (State-Tint Rule). */
export type StateTone = "success" | "warning" | "info" | "destructive" | "muted";

/**
 * Container state → tone, per the design target: running=success,
 * restarting=warning, paused=info, exited/dead=destructive (the status string
 * carries the exit code), everything transitional muted. A running-but-
 * unhealthy container downgrades to warning — the health probe is the truth.
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

/** Swarm task state → tone (running=ok, ready=info, preparing=warn, …). */
export function taskTone(state: string): StateTone {
  const s = state.toLowerCase();
  if (s === "running" || s === "complete") return "success";
  if (s === "failed" || s === "rejected" || s === "orphaned") return "destructive";
  if (s === "preparing" || s === "starting") return "warning";
  if (s === "shutdown" || s === "remove") return "muted";
  return "info"; // new / pending / assigned / accepted / ready
}
