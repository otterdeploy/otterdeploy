/**
 * Pure model for the deployment detail view — the row shape and the lifecycle →
 * phase-stepper mapping. Split out of deployment-detail.tsx (which renders it)
 * to keep that file under the line cap; nothing here touches React.
 */

export interface DeploymentRow {
  id: string;
  resourceId: string;
  image: string;
  reason: string;
  status:
    | "pending"
    | "building"
    | "starting"
    | "running"
    | "crashed"
    | "failed"
    | "superseded"
    | "removed";
  errorMessage: string | null;
  taskCount: number;
  failedTaskCount: number;
  runningTaskCount: number;
  gitSha: string | null;
  gitRef: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  sourceSha: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PhaseState = "done" | "active" | "failed" | "pending";
export interface Phase {
  key: string;
  label: string;
  state: PhaseState;
  detail?: string;
}
export type Tone = "success" | "failed" | "active" | "neutral";

/** The subset of a deployment the timeline actually reads — so both the fuller
 *  `DeploymentRow` (detail page) and the leaner deployments-collection row
 *  (drawer card) can drive the stepper without a shared shape. */
export type TimelineInput = Pick<
  DeploymentRow,
  "status" | "errorMessage" | "taskCount" | "completedAt" | "createdAt"
>;

/**
 * Map our coarse deployment lifecycle (pending → building → running/failed,
 * plus swarm task rollup) onto a Railway-style phase stepper. We only track
 * four honest checkpoints — Initialize → Build → Deploy → Running — and can't
 * fabricate per-phase timings, so each phase shows state only; the header
 * carries the one real duration we have (created → completed).
 */
export function buildTimeline(d: TimelineInput): {
  title: string;
  tone: Tone;
  phases: Phase[];
  totalMs: number | null;
} {
  const totalMs = d.completedAt
    ? new Date(d.completedAt).getTime() - new Date(d.createdAt).getTime()
    : null;
  const err = d.errorMessage?.trim() || null;
  const p = (key: string, label: string, state: PhaseState, detail?: string): Phase => ({
    key,
    label,
    state,
    detail,
  });
  const allDone = [
    p("init", "Initialization", "done"),
    p("build", "Build", "done"),
    p("deploy", "Deploy", "done"),
    p("run", "Post-deploy", "done"),
  ];

  switch (d.status) {
    case "running":
      return { title: "Deployed successfully", tone: "success", totalMs, phases: allDone };
    case "starting":
      // Image built; containers are coming up (pre-running) — the deploy phase
      // is active, the build one is done.
      return {
        title: "Starting up…",
        tone: "active",
        totalMs: null,
        phases: [
          p("init", "Initialization", "done"),
          p("build", "Build", "done"),
          p("deploy", "Deploy", "active"),
          p("run", "Post-deploy", "pending"),
        ],
      };
    case "building":
      return {
        title: "Deploying…",
        tone: "active",
        totalMs: null,
        phases: [
          p("init", "Initialization", "done"),
          p("build", "Build › Build image", "active"),
          p("deploy", "Deploy", "pending"),
          p("run", "Post-deploy", "pending"),
        ],
      };
    case "pending":
      return {
        title: "Queued",
        tone: "active",
        totalMs: null,
        phases: [
          p("init", "Initialization", "active"),
          p("build", "Build", "pending"),
          p("deploy", "Deploy", "pending"),
          p("run", "Post-deploy", "pending"),
        ],
      };
    case "failed":
      // Tasks scheduled ⇒ the image built and containers were placed, so the
      // failure is on the deploy side. No tasks ⇒ it never got past the build.
      return d.taskCount > 0
        ? {
            title: "Deployment failed during rollout",
            tone: "failed",
            totalMs,
            phases: [
              p("init", "Initialization", "done"),
              p("build", "Build", "done"),
              p("deploy", "Deploy", "failed", err ?? "Containers failed to start"),
              p("run", "Post-deploy", "pending"),
            ],
          }
        : {
            title: "Deployment failed during build process",
            tone: "failed",
            totalMs,
            phases: [
              p("init", "Initialization", "done"),
              p("build", "Build › Build image", "failed", err ?? "Build did not complete"),
              p("deploy", "Deploy", "pending"),
              p("run", "Post-deploy", "pending"),
            ],
          };
    case "crashed":
      // Built + deployed fine, but the container keeps exiting and restarting
      // (e.g. a bad env var) — the run phase is the one that's failing.
      return {
        title: "Crash-looping after deploy",
        tone: "failed",
        totalMs,
        phases: [
          p("init", "Initialization", "done"),
          p("build", "Build", "done"),
          p("deploy", "Deploy", "done"),
          p("run", "Post-deploy", "failed", err ?? "Container keeps restarting (crash loop)"),
        ],
      };
    case "superseded":
      // A benign replacement — this deploy was live/building when a newer one
      // took over (a FAILED deploy keeps its `failed` status, never lands here).
      return { title: "Replaced by a newer deployment", tone: "neutral", totalMs, phases: allDone };
    default:
      return { title: "Removed", tone: "neutral", totalMs, phases: allDone };
  }
}
