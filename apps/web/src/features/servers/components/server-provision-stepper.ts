import { epochMsFromIso } from "@/shared/lib/clock";

import { clockSpan, type InstallStep, type InstallStepState } from "../add-server/install-step";

/**
 * A structured, honest view of a provisioning run. The runner (server/
 * provision-runner.ts + provision.ts) narrates each step as a `── … ──` marker
 * line; we template the expected stages, light each one up from the markers
 * seen so far, and fall back to the persisted `provisionStatus` for the
 * terminal verdict, so a run whose live log was missed (see the
 * provision-stream race note) still resolves to ready/failed instead of an
 * eternal spinner.
 *
 * The dialog shows these grouped into the same four steps the command path
 * uses (see `sshSteps`); the detailed stages stay the source of truth.
 */

export type ProvisionStatus = "pending" | "provisioning" | "joining" | "ready" | "failed";

/** The subset of the server row the stepper needs to tailor the stage list. */
export interface ProvisionStageRow {
  provisionStatus: ProvisionStatus;
  provisionError: string | null;
  /** Null for the password-bootstrap path, which installs a managed key first. */
  sshKeyId: string | null;
  meshProvider: "none" | "tailscale" | "netbird";
  buildServer: boolean;
}

type StageState = InstallStepState;

interface StageDef {
  key: string;
  label: string;
  /** Does a `──` marker line belong to this stage? */
  match: (line: string) => boolean;
  /** Include this stage only when the run's config calls for it. Optional
   *  stages with no config flag (Cloudflare) return false and appear only once
   *  their marker is actually seen. */
  applies: (row: ProvisionStageRow | undefined) => boolean;
}

// Ordered to mirror the runner's emit sequence.
const STAGES: StageDef[] = [
  {
    key: "connect",
    label: "Connect over SSH",
    match: (l) => l.includes("connecting to"),
    applies: () => true,
  },
  {
    key: "ssh-key",
    label: "Install managed SSH key",
    match: (l) => l.includes("installing managed SSH key"),
    applies: (r) => r != null && r.sshKeyId == null,
  },
  {
    key: "probe",
    label: "Probe host",
    match: (l) => l.includes("probing host"),
    applies: () => true,
  },
  {
    key: "prereqs",
    label: "Install prerequisites",
    match: (l) => l.includes("installing prerequisites"),
    applies: () => true,
  },
  {
    key: "docker",
    label: "Install Docker",
    match: (l) => l.includes("installing Docker"),
    applies: () => true,
  },
  {
    key: "mesh",
    label: "Join mesh network",
    match: (l) => l.includes("mesh ──"),
    applies: (r) => r != null && r.meshProvider !== "none",
  },
  {
    key: "cloudflare",
    label: "Install Cloudflare Tunnel",
    match: (l) => l.includes("Cloudflare Tunnel"),
    applies: () => false,
  },
  {
    key: "swarm",
    label: "Join swarm",
    match: (l) => l.includes("joining swarm"),
    applies: () => true,
  },
  {
    key: "verify",
    label: "Verify node on manager",
    match: (l) => l.includes("verifying on the manager"),
    applies: () => true,
  },
  {
    key: "label",
    label: "Label as build node",
    match: (l) => l.includes("labelling as a build node"),
    applies: (r) => r?.buildServer === true,
  },
  { key: "ready", label: "Server ready", match: () => false, applies: () => true },
];

interface StageView {
  key: string;
  label: string;
  state: StageState;
}

/** Derive the tailored stage list and each stage's state from the marker lines
 *  seen so far plus the terminal verdict. Pure: unit-testable in isolation. */
export function computeStages(lines: string[], row: ProvisionStageRow | undefined): StageView[] {
  const markers = lines.filter((l) => l.startsWith("──"));
  const streamFailed = lines.some((l) => l.startsWith("✗"));
  const streamReady = lines.some((l) => l.startsWith("✓"));
  const failed = streamFailed || row?.provisionStatus === "failed";
  const ready = streamReady || row?.provisionStatus === "ready";
  const inFlight = row?.provisionStatus === "provisioning" || row?.provisionStatus === "joining";

  // A stage shows when its config applies OR its marker actually appeared.
  const shown = STAGES.filter((s) => s.applies(row) || markers.some(s.match));

  // Active = the furthest-along stage whose marker we've seen.
  let activeIdx = -1;
  shown.forEach((s, i) => {
    if (markers.some(s.match)) activeIdx = i;
  });
  // No markers yet but the row says it's running. Surface the first stage as
  // active so the view reads as "working", not frozen.
  if (activeIdx === -1 && !ready && !failed && inFlight) activeIdx = 0;

  return shown.map((s, i) => {
    let state: StageState;
    if (ready) state = "done";
    else if (activeIdx === -1) state = "pending";
    else if (i < activeIdx) state = "done";
    else if (i === activeIdx) state = failed ? "failed" : "active";
    else state = "pending";
    return { key: s.key, label: s.label, state };
  });
}

/** A provisioning log line as the stream delivers it. */
export interface ProvisionLine {
  line: string;
  ts: string;
}

/**
 * The detailed stages folded into the four steps the dialog shows. Each
 * milestone owns the runner stages that lead up to it: mesh, tunnel, joining
 * and verification are all part of "Connected", because the server is not
 * usable until every one of them has passed.
 */
const PHASES: readonly { key: string; label: string; stages: readonly string[] }[] = [
  { key: "ssh", label: "Connected over SSH", stages: ["connect", "ssh-key"] },
  { key: "check", label: "System checked", stages: ["probe", "prereqs"] },
  { key: "docker", label: "Installing Docker", stages: ["docker"] },
  {
    key: "connected",
    label: "Connected",
    stages: ["mesh", "cloudflare", "swarm", "verify", "label", "ready"],
  },
];

function phaseIndexOfMarker(line: string): number {
  const stage = STAGES.find((s) => s.match(line));
  return stage ? PHASES.findIndex((p) => p.stages.includes(stage.key)) : -1;
}

function phaseState(states: StageState[]): StageState {
  if (states.includes("failed")) return "failed";
  if (states.length > 0 && states.every((s) => s === "done")) return "done";
  if (states.some((s) => s !== "pending")) return "active";
  return "pending";
}

/**
 * When each phase finished, as epoch ms: the first marker of any later phase,
 * or the run's own success line for the last one.
 */
function phaseEnds(lines: readonly ProvisionLine[]): (number | null)[] {
  return PHASES.map((_, i) => {
    const next = lines.find((l) =>
      i === PHASES.length - 1
        ? l.line.startsWith("✓")
        : l.line.startsWith("──") && phaseIndexOfMarker(l.line) > i,
    );
    return next ? epochMsFromIso(next.ts) : null;
  });
}

/** The four steps of an SSH install, timed from the run's first line. */
export function sshSteps(
  lines: readonly ProvisionLine[],
  row: ProvisionStageRow | undefined,
): InstallStep[] {
  const stages = computeStages(
    lines.map((l) => l.line),
    row,
  );
  const start = lines[0] ? epochMsFromIso(lines[0].ts) : null;
  const ends = phaseEnds(lines);
  return PHASES.map((phase, i) => {
    const state = phaseState(
      stages.filter((s) => phase.stages.includes(s.key)).map((s) => s.state),
    );
    const end = ends[i] ?? null;
    const at = state === "done" && start !== null && end !== null ? clockSpan(end - start) : null;
    return { key: phase.key, label: phase.label, state, at };
  });
}

/** The step a failed run stopped on, for the outcome's headline. */
export function failedSshStep(steps: readonly InstallStep[]): string | null {
  return steps.find((s) => s.state === "failed")?.key ?? null;
}
