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
