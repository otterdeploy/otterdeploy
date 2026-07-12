/**
 * Transient apply run-state — in-memory, single-node (the aeroplane pattern).
 *
 * An update runs at most once at a time, so one module-level `activeRun` holds
 * the status + accumulated progress events, and a tiny pub/sub lets the oRPC
 * event-iterator (`system.progress`) replay-then-tail it. A best-effort JSON
 * snapshot under DATA_DIR survives the server being recreated mid-update, so
 * after the browser reconnects it can read the FINAL outcome of a real cutover
 * (the in-memory copy is gone with the old container). Dry-run never restarts,
 * so it completes over the live stream and never needs the file.
 */
import { DATA_ROOT } from "@otterdeploy/shared/paths";
import { Result } from "better-result";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isNewer } from "./compare";

export type UpdateRunStatus = "idle" | "running" | "succeeded" | "failed";
export type UpdatePhase = "validate" | "pull" | "migrate" | "recreate" | "handoff" | "done";
export type ProgressLevel = "info" | "success" | "error";

export interface ProgressEvent {
  seq: number;
  ts: string;
  level: ProgressLevel;
  phase: UpdatePhase;
  message: string;
}

export interface UpdateRunSnapshot {
  status: UpdateRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  targetVersion: string | null;
  /** True when the run handed off to a detached helper (real path) — the
   *  server is being recreated, so the stream won't carry the final result;
   *  the client polls /health and re-reads the snapshot instead. */
  handedOff: boolean;
  error: string | null;
  logs: ProgressEvent[];
}

const STATUS_FILE = join(DATA_ROOT, "update-status.json");
const MAX_LOGS = 500;

function idle(): UpdateRunSnapshot {
  return {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    targetVersion: null,
    handedOff: false,
    error: null,
    logs: [],
  };
}

let run: UpdateRunSnapshot = idle();
let seq = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const wake of listeners) wake();
}

/** Best-effort persist — never throws, so a read-only data dir (dev) can't
 *  fail an update. */
async function persist(): Promise<void> {
  await Result.tryPromise({
    try: async () => {
      await mkdir(dirname(STATUS_FILE), { recursive: true });
      await writeFile(STATUS_FILE, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
    },
    catch: (cause) => cause,
  });
}

/** Is an update already in flight? Guards against concurrent applies. */
export function isRunning(): boolean {
  return run.status === "running";
}

export function snapshot(): UpdateRunSnapshot {
  return { ...run, logs: [...run.logs] };
}

/** Begin a run, clearing any prior logs. Caller must have checked isRunning(). */
export function begin(targetVersion: string): void {
  run = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    targetVersion,
    handedOff: false,
    error: null,
    logs: [],
  };
  seq = 0;
  notify();
  void persist();
}

export function emit(phase: UpdatePhase, message: string, level: ProgressLevel = "info"): void {
  run.logs.push({ seq: ++seq, ts: new Date().toISOString(), level, phase, message });
  if (run.logs.length > MAX_LOGS) run.logs = run.logs.slice(run.logs.length - MAX_LOGS);
  notify();
  void persist();
}

/** Mark the run as handed off to the detached helper (real cutover). The stream
 *  ends here; the container is about to be replaced. */
export function markHandoff(): void {
  run.handedOff = true;
  notify();
  void persist();
}

export function finish(ok: boolean, error?: string): void {
  run.status = ok ? "succeeded" : "failed";
  run.finishedAt = new Date().toISOString();
  run.error = error ?? null;
  notify();
  void persist();
}

/** Replay accumulated events then tail new ones until the run is terminal (and
 *  fully drained) or the client aborts. A handoff also ends the stream — the
 *  server is going away. */
export async function* streamProgress(
  signal: AbortSignal | undefined,
): AsyncGenerator<ProgressEvent> {
  let cursor = 0;
  let wake: (() => void) | null = null;
  const listener = () => wake?.();
  listeners.add(listener);
  const onAbort = () => wake?.();
  signal?.addEventListener("abort", onAbort);

  try {
    while (!signal?.aborted) {
      while (cursor < run.logs.length) {
        const event = run.logs[cursor++];
        if (event) yield event;
      }
      const terminal = run.status === "succeeded" || run.status === "failed" || run.handedOff;
      if (terminal && cursor >= run.logs.length) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  } finally {
    listeners.delete(listener);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Read the persisted snapshot from disk — used after a restart to recover the
 *  final outcome of a real cutover. Null if absent/unreadable. */
export async function readPersistedSnapshot(): Promise<UpdateRunSnapshot | null> {
  const res = await Result.tryPromise({
    try: async () => JSON.parse(await readFile(STATUS_FILE, "utf8")) as UpdateRunSnapshot,
    catch: (cause) => cause,
  });
  return res.isOk() ? res.value : null;
}

/**
 * Settle a handed-off run after the cutover. The old server dies the moment
 * the helper recreates the stack, so nobody ever wrote a terminal outcome —
 * the snapshot stayed "running" forever and the UI showed a perpetually
 * in-flight update. Called once on server boot: if the persisted run is still
 * running+handedOff, compare the version we ACTUALLY booted as against the
 * target, restore the run in memory (so updateState/progress serve the real
 * outcome), and persist the terminal state.
 */
export async function finalizeHandedOffRun(bootedVersion: string): Promise<void> {
  const snap = await readPersistedSnapshot();
  if (!snap || snap.status !== "running" || !snap.handedOff || !snap.targetVersion) return;

  const reachedTarget =
    snap.targetVersion === bootedVersion || isNewer(bootedVersion, snap.targetVersion);

  run = { ...snap, logs: [...snap.logs] };
  seq = run.logs.reduce((max, l) => Math.max(max, l.seq), 0);
  emit(
    "done",
    reachedTarget
      ? `Update to ${snap.targetVersion} complete — control plane is running ${bootedVersion}.`
      : `Control plane came back on ${bootedVersion}, expected ${snap.targetVersion} — the cutover may have failed or rolled back.`,
    reachedTarget ? "success" : "error",
  );
  finish(
    reachedTarget,
    reachedTarget ? undefined : `Booted ${bootedVersion} instead of target ${snap.targetVersion}.`,
  );
}
