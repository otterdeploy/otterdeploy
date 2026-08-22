/**
 * Pure parsing for the systemd collector: `systemctl` text in, typed values
 * out. Nothing here spawns a process or touches the filesystem, which is what
 * makes the whole feature testable against fixture strings on a machine that
 * has never run systemd. The collector itself lives in `systemd.ts`.
 */

/**
 * systemd's `ActiveState`. "unknown" is OURS, not systemd's: it is where the
 * parser puts a value a newer systemd invented. Coercing an unrecognised
 * state into "inactive" or "failed" would be inventing a claim about the
 * host, which is exactly what this product refuses to do.
 */
export const UNIT_ACTIVE_STATES = [
  "active",
  "reloading",
  "inactive",
  "failed",
  "activating",
  "deactivating",
  "unknown",
] as const;
export type UnitActiveState = (typeof UNIT_ACTIVE_STATES)[number];

/**
 * systemd's `SubState`. Service-unit values across systemd 245–257; the set
 * genuinely grows between releases (`dead-before-auto-restart` and friends
 * arrived in v254), so anything unrecognised lands on "unknown" rather than
 * being forced into a neighbour.
 */
export const UNIT_SUB_STATES = [
  "dead",
  "condition",
  "start-pre",
  "start",
  "start-post",
  "running",
  "exited",
  "reload",
  "reload-signal",
  "reload-notify",
  "stop",
  "stop-watchdog",
  "stop-sigterm",
  "stop-sigkill",
  "stop-post",
  "final-watchdog",
  "final-sigterm",
  "final-sigkill",
  "failed",
  "auto-restart",
  "auto-restart-queued",
  "cleaning",
  "dead-before-auto-restart",
  "failed-before-auto-restart",
  "dead-resources-pinned",
  "mounting",
  "mounted",
  "unknown",
] as const;
export type UnitSubState = (typeof UNIT_SUB_STATES)[number];

/** systemd reports "this counter is not available" as UINT64_MAX. Read as a
 *  number it is 1.8e19, which would render as 18 exabytes of RAM. */
const UINT64_MAX = "18446744073709551615";

export type UnitProperties = Record<string, string>;

/**
 * Undo systemd's C-style escaping. `\x2d` is `-`; systemd escapes any byte
 * that cannot appear literally in a unit name, so device and mount units come
 * back looking like `dev-disk-by\x2duuid-1234.device`. Left raw, the escape
 * sequences leak straight into the UI.
 */
export function unescapeUnitName(raw: string): string {
  // Decoded a RUN at a time, not one escape at a time: a non-ASCII character
  // is escaped as consecutive `\xNN` bytes of its UTF-8 encoding, and turning
  // each byte into its own code point would produce mojibake.
  return raw.replace(/(?:\\x[0-9a-fA-F]{2})+/g, (run) => {
    const bytes = Uint8Array.from(
      run
        .split("\\x")
        .slice(1)
        .map((hex) => Number.parseInt(hex, 16)),
    );
    return new TextDecoder().decode(bytes);
  });
}

/**
 * Parse the `Key=Value` block `systemctl show` writes. Values may contain
 * `=` (ExecStart lines are full of them), so only the FIRST `=` separates.
 * Lines without one are ignored rather than guessed at.
 */
export function parseShowProperties(text: string): UnitProperties {
  const props: UnitProperties = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    props[line.slice(0, eq)] = line.slice(eq + 1).trimEnd();
  }
  return props;
}

/** Runtime membership check that narrows: a real type guard, not a cast. */
function isKnown<T extends string>(values: readonly T[], candidate: string): candidate is T {
  return values.some((value) => value === candidate);
}

export function parseActiveState(raw: string | undefined): UnitActiveState {
  const value = raw?.trim() ?? "";
  return isKnown(UNIT_ACTIVE_STATES, value) ? value : "unknown";
}

export function parseSubState(raw: string | undefined): UnitSubState {
  const value = raw?.trim() ?? "";
  return isKnown(UNIT_SUB_STATES, value) ? value : "unknown";
}

/** A systemd uint64 counter, with UINT64_MAX ("not available") read as null. */
export function parseCounter(raw: string | undefined): number | null {
  const value = raw?.trim() ?? "";
  if (!/^\d+$/.test(value) || value === UINT64_MAX) return null;
  return Number(value);
}

/** Same, as a bigint: CPUUsageNSec on a long-lived busy unit passes 2^53. */
export function parseCounterBig(raw: string | undefined): bigint | null {
  const value = raw?.trim() ?? "";
  if (!/^\d+$/.test(value) || value === UINT64_MAX) return null;
  return BigInt(value);
}

/**
 * Memory as a pair, with the peak floored at current.
 *
 * Some kernels (and any unit whose cgroup lacks `memory.peak`) report a flat
 * 0 for MemoryPeak forever. A peak below the live current reading is not a
 * peak, so it is raised. A peak that is genuinely UNAVAILABLE stays null:
 * echoing `current` there would dress a missing measurement up as a real one.
 */
export function readMemory(props: UnitProperties): {
  memBytes: number | null;
  memPeakBytes: number | null;
} {
  const memBytes = parseCounter(props.MemoryCurrent);
  const rawPeak = parseCounter(props.MemoryPeak);
  const memPeakBytes =
    rawPeak !== null && memBytes !== null && memBytes > rawPeak ? memBytes : rawPeak;
  return { memBytes, memPeakBytes };
}

/** "" / "0" / UINT64_MAX in a timestamp field all mean "this never happened". */
function isNeverMarker(value: string): boolean {
  return value === "" || value === "0" || value === UINT64_MAX;
}

/** Best-effort instant from whichever spelling of ActiveEnterTimestamp we got. */
function parseEnterInstant(raw: string): Date | null {
  if (/^\d+$/.test(raw)) {
    // D-Bus spelling: microseconds since the epoch.
    return isNeverMarker(raw) ? null : new Date(Number(BigInt(raw) / 1000n));
  }
  if (raw === "") return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type ActiveEnter = { neverActive: true } | { neverActive: false; at: Date | null };

/**
 * When the unit last entered `active`.
 *
 * `neverActive` is the load-bearing half: a unit whose ActiveEnter timestamp
 * is 0 or UINT64_MAX has never run, and a host is full of those (every
 * oneshot that only fires on an event, every socket-activated service nobody
 * has touched). Listing them buries the services an operator actually cares
 * about.
 *
 * The monotonic property decides, because it is always numeric.
 * `ActiveEnterTimestamp` itself is a human string under `systemctl show`
 * ("Mon 2026-08-18 09:12:31 UTC") but a raw microsecond count over D-Bus, so
 * both spellings are accepted, and a value we cannot read degrades to
 * `at: null` WITHOUT claiming the unit never ran.
 */
export function parseActiveEnter(props: UnitProperties): ActiveEnter {
  const mono = props.ActiveEnterTimestampMonotonic?.trim() ?? "";
  const raw = props.ActiveEnterTimestamp?.trim() ?? "";
  const authoritative = /^\d+$/.test(mono) ? mono : raw;
  if (isNeverMarker(authoritative)) return { neverActive: true };
  return { neverActive: false, at: parseEnterInstant(raw) };
}

/**
 * Unit names out of `systemctl list-units --plain --no-legend`. The first
 * column is the unit; `--plain` should already have dropped the `●` marker
 * failed units carry, but it is stripped defensively so a systemd that
 * ignores the flag does not produce a unit named "●".
 */
export function parseListUnitNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.replace(/^[\s●*]+/, "").trim();
    if (trimmed === "") continue;
    const first = trimmed.split(/\s+/)[0];
    if (first === undefined || !first.includes(".")) continue;
    names.push(first);
  }
  return names;
}

export interface CpuBaseline {
  cpuNSec: bigint;
  /** Monotonic wall clock, nanoseconds. */
  atNs: bigint;
}

/**
 * CPUUsageNSec is cumulative, so percent is a rate between two reads:
 * `delta / (elapsed × cores) × 100`.
 *
 * Two cases must not produce a number:
 *  - No previous reading. There is nothing to subtract; 0 beats a fabricated
 *    rate computed against the unit's whole lifetime.
 *  - The counter went BACKWARDS. The unit restarted and systemd reset its
 *    cgroup accounting. A negative delta would render as a negative percent,
 *    so the caller re-anchors the baseline and this sample reads 0.
 */
export function computeCpuPct(
  previous: CpuBaseline | undefined,
  cpuNSec: bigint | null,
  nowNs: bigint,
  cores: number,
): number {
  if (cpuNSec === null || previous === undefined) return 0;
  const elapsedNs = nowNs - previous.atNs;
  if (elapsedNs <= 0n || cores <= 0) return 0;
  if (cpuNSec < previous.cpuNSec) return 0; // counter reset: re-anchor, emit 0
  const deltaNs = cpuNSec - previous.cpuNSec;
  const pct = (Number(deltaNs) / (Number(elapsedNs) * cores)) * 100;
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.round(Math.min(pct, 100) * 100) / 100;
}
