/**
 * Per-unit systemd introspection: what the SYSTEM services on a managed host
 * are doing right now (docker, sshd, the firewall, the log shipper, …). The
 * host-health card answers "is this machine out of memory"; this answers "is
 * the thing that makes this machine useful actually running".
 *
 * WHY systemctl AND NOT D-BUS: there is no D-Bus binding for Node/Bun worth
 * taking a native dependency for, and none is needed. `systemctl show` speaks
 * the same properties over a pipe, and the numbers we want (CPUUsageNSec,
 * MemoryCurrent, MemoryPeak) are the unit cgroup's own counters, read by
 * systemd from the same place a D-Bus caller would land.
 *
 * Discipline matches host-health.ts: best-effort, honest-about-system-state.
 * A host with no systemd (macOS dev, a container) returns null QUIETLY: no
 * throw, no error log, because "not applicable" is not a fault. A wedged
 * systemctl hits the exec timeout and degrades the section to null rather
 * than hanging the caller.
 *
 * This module is deliberately DB-free and validated-env-free: the per-node
 * health agent (apps/server/src/health-agent.ts) imports modules like this
 * one directly and boots with nothing but a few raw env vars.
 *
 * The pure text→value half lives in `systemd-parse.ts`.
 */
import { Result } from "better-result";
import { existsSync } from "node:fs";
import { cpus } from "node:os";

import {
  computeCpuPct,
  parseActiveEnter,
  parseActiveState,
  parseCounter,
  parseCounterBig,
  parseListUnitNames,
  parseShowProperties,
  parseSubState,
  readMemory,
  unescapeUnitName,
  type CpuBaseline,
  type UnitActiveState,
  type UnitProperties,
  type UnitSubState,
} from "./systemd-parse";

export {
  computeCpuPct,
  parseActiveEnter,
  parseActiveState,
  parseCounter,
  parseCounterBig,
  parseListUnitNames,
  parseShowProperties,
  parseSubState,
  readMemory,
  unescapeUnitName,
  UNIT_ACTIVE_STATES,
  UNIT_SUB_STATES,
  type CpuBaseline,
  type UnitActiveState,
  type UnitProperties,
  type UnitSubState,
} from "./systemd-parse";

export interface SystemdUnit {
  /** Unescaped unit name: `dev-disk-by\x2duuid-…` → `dev-disk-by-uuid-…`. */
  name: string;
  activeState: UnitActiveState;
  subState: UnitSubState;
  /** Percent of one host's worth of CPU (0–100), derived across two reads.
   *  The FIRST read of a unit is always 0: a cumulative counter cannot yield
   *  a rate until there is something to subtract from. */
  cpuPct: number;
  /** Null when the unit has no memory accounting (cgroup off, UINT64_MAX). */
  memBytes: number | null;
  memPeakBytes: number | null;
  restartCount: number;
  /** When the unit last entered `active`, ISO-8601. Null when systemd reports
   *  a timestamp we cannot read; units that have NEVER been active are
   *  dropped from the section entirely rather than surfaced with a null. */
  activeEnterTimestamp: string | null;
}

export interface SystemdSection {
  units: SystemdUnit[];
  sampledAt: string;
}

/** Generous for a healthy manager (`systemctl show` is single-digit ms);
 *  small enough that a wedged systemd degrades the section instead of
 *  stalling the health report behind it. Same shape as the firewall's
 *  `EXEC_TIMEOUT_MS` in routers/firewall/cscli.ts. */
const EXEC_TIMEOUT_MS = 5_000;

/** Whole-collection budget. Per-exec timeouts alone would let a host with
 *  300 wedged units hold the caller for minutes. */
const COLLECT_BUDGET_MS = 20_000;

/** Property reads in flight at once. A `systemctl show` is cheap; the cap is
 *  about not forking hundreds of processes at the same instant. */
const SHOW_CONCURRENCY = 8;

/** Hard ceiling on units per report, so a pathological host cannot turn one
 *  health report into a multi-megabyte payload. */
const MAX_UNITS = 400;

/** One batched `systemctl show` per unit fetches all of these at once: a
 *  property-per-exec loop would be hundreds of forks per report. */
const UNIT_PROPERTIES = [
  "Id",
  "LoadState",
  "ActiveState",
  "SubState",
  "CPUUsageNSec",
  "MemoryCurrent",
  "MemoryPeak",
  "NRestarts",
  "ActiveEnterTimestamp",
  "ActiveEnterTimestampMonotonic",
] as const;

/** Per-unit previous CPU reading. Module state on purpose: a rate needs
 *  memory, and the collector is a singleton per host process. */
const cpuBaselines = new Map<string, CpuBaseline>();

/** Run `systemctl <argv>`; null on spawn failure, non-zero exit, or timeout. */
export type SystemctlExec = (argv: string[], timeoutMs: number) => Promise<string | null>;

async function spawnSystemctl(argv: string[], timeoutMs: number): Promise<string | null> {
  const spawned = Result.try({
    try: () => Bun.spawn(["systemctl", ...argv], { stdout: "pipe", stderr: "ignore" }),
    catch: () => null,
  });
  if (spawned.isErr()) return null;
  const proc = spawned.value;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9);
  }, timeoutMs);
  try {
    const output = await Result.tryPromise({
      try: async () => {
        const text = await new Response(proc.stdout).text();
        await proc.exited;
        return text;
      },
      catch: () => null,
    });
    if (output.isErr() || timedOut) return null;
    return proc.exitCode === 0 ? output.value : null;
  } finally {
    clearTimeout(timer);
  }
}

/** `/run/systemd/system` exists if and only if systemd is the running init:
 *  the same probe `sd_booted(3)` performs. Checked BEFORE spawning anything,
 *  so a mac never forks a `systemctl` that isn't there. */
function systemdIsBooted(): boolean {
  return existsSync("/run/systemd/system");
}

/**
 * Operator-configurable unit globs, comma-separated:
 *   OTTERDEPLOY_SYSTEMD_UNITS="docker.service,ssh*.service,crowdsec*"
 * Unset means every service on the host, which is the default worth having.
 */
function configuredPatterns(): string[] {
  // oxlint-disable-next-line node/no-process-env -- imported by the health agent, which boots with NO validated env (see module note)
  const raw = process.env.OTTERDEPLOY_SYSTEMD_UNITS ?? "";
  return raw
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== "");
}

export interface CollectOptions {
  /** Seam for tests: fixture strings instead of a live host. */
  exec?: SystemctlExec;
  /** Seam for tests: monotonic nanoseconds. */
  nowNs?: () => bigint;
  /** Seam for tests: the wall clock stamped onto the section. */
  now?: () => Date;
  /** Seam for tests, and hosts where `os.cpus()` under-reports. */
  cpuCount?: number;
  /** Seam for tests: override the systemd probe. */
  hasSystemd?: () => boolean;
  /** Override the operator's configured unit globs. */
  patterns?: string[];
  /** Seam for tests: an isolated CPU baseline map. */
  baselines?: Map<string, CpuBaseline>;
}

interface Resolved {
  exec: SystemctlExec;
  nowNs: () => bigint;
  clock: () => Date;
  cores: number;
  baselines: Map<string, CpuBaseline>;
  patterns: string[];
}

function resolveOptions(options: CollectOptions): Resolved {
  return {
    exec: options.exec ?? spawnSystemctl,
    nowNs: options.nowNs ?? (() => process.hrtime.bigint()),
    clock: options.now ?? (() => new Date()),
    cores: options.cpuCount ?? Math.max(1, cpus().length),
    baselines: options.baselines ?? cpuBaselines,
    patterns: options.patterns ?? configuredPatterns(),
  };
}

/** Map `worker(item)` over `items`, at most `limit` in flight. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Properties → one unit row, or null when the unit has never been active. */
function toUnit(
  props: UnitProperties,
  fallbackName: string,
  ctx: { nowNs: bigint; cores: number; baselines: Map<string, CpuBaseline> },
): SystemdUnit | null {
  const activeEnter = parseActiveEnter(props);
  if (activeEnter.neverActive) return null;

  const name = unescapeUnitName(props.Id ?? fallbackName);
  const cpuNSec = parseCounterBig(props.CPUUsageNSec);
  const cpuPct = computeCpuPct(ctx.baselines.get(name), cpuNSec, ctx.nowNs, ctx.cores);
  if (cpuNSec !== null) ctx.baselines.set(name, { cpuNSec, atNs: ctx.nowNs });

  const { memBytes, memPeakBytes } = readMemory(props);
  return {
    name,
    activeState: parseActiveState(props.ActiveState),
    subState: parseSubState(props.SubState),
    cpuPct,
    memBytes,
    memPeakBytes,
    restartCount: parseCounter(props.NRestarts) ?? 0,
    activeEnterTimestamp: activeEnter.at?.toISOString() ?? null,
  };
}

/**
 * The whole section. Null means "no answer": no systemd, or systemctl did not
 * respond in time. Never throws, and never logs an error for a host that
 * simply does not run systemd.
 */
export async function getSystemdUnits(
  options: CollectOptions = {},
): Promise<SystemdSection | null> {
  const hasSystemd = options.hasSystemd ?? systemdIsBooted;
  if (!hasSystemd()) return null;
  const { exec, nowNs, clock, cores, baselines, patterns } = resolveOptions(options);

  const listed = await exec(
    [
      "list-units",
      "--type=service",
      "--all",
      "--plain",
      "--no-legend",
      "--no-pager",
      // Patterns are separate argv entries after `--`, never interpolated
      // into a shell, so an operator glob cannot become a command.
      ...(patterns.length > 0 ? ["--", ...patterns] : []),
    ],
    EXEC_TIMEOUT_MS,
  );
  if (listed === null) return null;

  const names = parseListUnitNames(listed).slice(0, MAX_UNITS);
  const deadline = Date.now() + COLLECT_BUDGET_MS;

  const collected = await mapPool(names, SHOW_CONCURRENCY, async (name) => {
    if (Date.now() > deadline) return null;
    const shown = await exec(
      ["show", name, ...UNIT_PROPERTIES.map((property) => `--property=${property}`)],
      EXEC_TIMEOUT_MS,
    );
    if (shown === null) return null;
    return toUnit(parseShowProperties(shown), name, { nowNs: nowNs(), cores, baselines });
  });

  const units: SystemdUnit[] = [];
  for (const unit of collected) {
    if (unit !== null) units.push(unit);
  }
  pruneBaselines(baselines, names);
  return { units, sampledAt: clock().toISOString() };
}

/**
 * Forget baselines for units that are no longer on the host: the map is
 * otherwise unbounded on a churny box. Keyed off the LISTED names, not the
 * emitted ones, so a unit whose property read happened to time out keeps its
 * baseline and still reports a real rate on the next pass.
 */
function pruneBaselines(baselines: Map<string, CpuBaseline>, names: string[]): void {
  const live = new Set(names.map(unescapeUnitName));
  for (const key of baselines.keys()) {
    if (!live.has(key)) baselines.delete(key);
  }
}

/**
 * Every property systemd knows about ONE unit, for the on-demand detail view.
 * Deliberately not part of the periodic report: the full set is ~150 keys per
 * unit, which would multiply a routine health payload by two orders of
 * magnitude for data nobody is looking at.
 */
export async function getUnitDetails(
  name: string,
  options: Pick<CollectOptions, "exec" | "hasSystemd"> = {},
): Promise<UnitProperties | null> {
  const hasSystemd = options.hasSystemd ?? systemdIsBooted;
  if (!hasSystemd()) return null;
  const exec = options.exec ?? spawnSystemctl;
  // `name` is its own argv entry, never passed through a shell.
  const shown = await exec(["show", name, "--no-pager"], EXEC_TIMEOUT_MS);
  if (shown === null) return null;
  const props = parseShowProperties(shown);
  if (props.Id !== undefined) props.Id = unescapeUnitName(props.Id);
  return props;
}
