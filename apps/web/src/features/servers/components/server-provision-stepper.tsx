import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";

/**
 * A structured, honest view of a provisioning run. The runner (server/
 * provision-runner.ts + provision.ts) narrates each step as a `── … ──` marker
 * line; we template the expected stages, light each one up from the markers
 * seen so far, and fall back to the persisted `provisionStatus` for the
 * terminal verdict — so a run whose live log was missed (see the
 * provision-stream race note) still resolves to ready/failed instead of an
 * eternal spinner. Raw log stays available under the stepper for detail.
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

type StageState = "pending" | "active" | "done" | "failed";

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
 *  seen so far plus the terminal verdict. Pure — unit-testable in isolation. */
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
  // No markers yet but the row says it's running — surface the first stage as
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

function StageIcon({ state }: { state: StageState }) {
  if (state === "done")
    return (
      <HugeiconsIcon icon={Tick02Icon} strokeWidth={2.5} className="size-4 text-emerald-500" />
    );
  if (state === "failed")
    return <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} className="size-4 text-red-500" />;
  if (state === "active") return <Spinner className="size-4 text-foreground" />;
  return <span aria-hidden className="size-3 rounded-full ring-1 ring-foreground/25" />;
}

export function ProvisionStepper({
  lines,
  row,
}: {
  lines: string[];
  row: ProvisionStageRow | undefined;
}) {
  const stages = computeStages(lines, row);
  const failedError = row?.provisionStatus === "failed" ? row.provisionError : null;

  return (
    <ol className="flex flex-col gap-1">
      {stages.map((s) => (
        <li key={s.key} className="flex items-center gap-3 py-1">
          <span className="flex size-4 shrink-0 items-center justify-center">
            <StageIcon state={s.state} />
          </span>
          <span
            className={cn(
              "text-sm",
              s.state === "pending" && "text-muted-foreground",
              s.state === "active" && "text-foreground",
              s.state === "done" && "text-foreground",
              s.state === "failed" && "text-red-500",
            )}
          >
            {s.label}
          </span>
        </li>
      ))}
      {failedError ? (
        <li className="mt-1 rounded-md bg-red-500/[0.06] px-3 py-2 text-[12px] leading-relaxed text-red-500 ring-1 ring-red-500/20">
          {failedError}
        </li>
      ) : null}
    </ol>
  );
}
