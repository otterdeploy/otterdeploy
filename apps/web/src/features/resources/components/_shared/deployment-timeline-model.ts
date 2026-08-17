/**
 * Pure model for the deployment detail view: the row shape and the lifecycle →
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
    | "paused"
    | "failed"
    | "cancelled"
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
  /** Avatar of the GitHub account the commit is attributed to; null when the
   *  commit's email matches no user. */
  gitCommitAuthorAvatar?: string | null;
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
/** `degraded` = the rollout finished but not every replica is running. It is
 *  deliberately distinct from both `success` and `failed`: nothing errored, and
 *  the deployment is genuinely live, but calling it a success would be a lie. */
export type Tone = "success" | "failed" | "active" | "neutral" | "degraded";

/** The subset of a deployment the timeline actually reads, so both the fuller
 *  `DeploymentRow` (detail page) and the leaner deployments-collection row
 *  (drawer card) can drive the stepper without a shared shape. */
export type TimelineInput = Pick<
  DeploymentRow,
  "status" | "errorMessage" | "taskCount" | "runningTaskCount" | "completedAt" | "createdAt"
>;

/** What the phase stepper needs to render one deployment. */
export interface Timeline {
  title: string;
  tone: Tone;
  phases: Phase[];
  totalMs: number | null;
}

/** Phase constructor. Module-level so the per-status builders below share it
 *  with {@link buildTimeline} instead of each re-declaring the shape. */
const p = (key: string, label: string, state: PhaseState, detail?: string): Phase => ({
  key,
  label,
  state,
  detail,
});

/**
 * The two shapes a `failed` deployment takes. Split out of {@link buildTimeline}
 * so its status switch stays inside the complexity budget. This one branch
 * carries a nested ternary plus two error-message fallbacks, which is a third of
 * the whole function's branching.
 *
 * Tasks scheduled ⇒ the image built and containers were placed, so the failure
 * is on the deploy side. No tasks ⇒ it never got past the build.
 */
function failedTimeline(taskCount: number, err: string | null, totalMs: number | null): Timeline {
  if (taskCount > 0) {
    return {
      title: "Deployment failed during rollout",
      tone: "failed",
      totalMs,
      phases: [
        p("init", "Initialization", "done"),
        p("build", "Build", "done"),
        p("deploy", "Deploy", "failed", err ?? "Containers failed to start"),
        p("run", "Post-deploy", "pending"),
      ],
    };
  }
  return {
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
}

/**
 * A `running` deployment is not automatically a successful one.
 *
 * The incident: a service whose container came up, failed its healthcheck, and
 * sat at `Up 14 minutes (unhealthy)` returning 404 to every request, while the
 * dashboard displayed "Deployed successfully" with four green checks. The
 * rollup that would have contradicted it (`runningTaskCount` vs `taskCount`)
 * was already on the row; the timeline just never read it.
 *
 * `running` means the rollout finished, not that the replicas are up. When they
 * aren't, say so. PRODUCT.md's honest-about-system-state principle is not
 * satisfied by a green check that happens to be wrong.
 */
function runningTimeline(
  taskCount: number,
  runningTaskCount: number,
  totalMs: number | null,
): Timeline {
  const allRunning = [
    p("init", "Initialization", "done"),
    p("build", "Build", "done"),
    p("deploy", "Deploy", "done"),
    p("run", "Post-deploy", "done"),
  ];

  // taskCount 0 = no rollup yet (a fresh row, or a resource kind that doesn't
  // report tasks). Absence of evidence isn't evidence of failure, so the
  // unqualified success message stands until the rollup says otherwise.
  if (taskCount === 0 || runningTaskCount >= taskCount) {
    return { title: "Deployed successfully", tone: "success", totalMs, phases: allRunning };
  }

  const down = taskCount - runningTaskCount;
  return {
    title:
      runningTaskCount === 0
        ? "Deployed, but no replicas are running"
        : `Deployed, but ${down} of ${taskCount} replicas are not running`,
    tone: "degraded",
    totalMs,
    phases: [
      p("init", "Initialization", "done"),
      p("build", "Build", "done"),
      p("deploy", "Deploy", "done"),
      p(
        "run",
        "Post-deploy",
        "failed",
        `${runningTaskCount}/${taskCount} replicas running. Check the container logs and healthcheck.`,
      ),
    ],
  };
}

/**
 * Map our coarse deployment lifecycle (pending → building → running/failed,
 * plus swarm task rollup) onto a Railway-style phase stepper. We only track
 * four honest checkpoints (Initialize → Build → Deploy → Running) and can't
 * fabricate per-phase timings, so each phase shows state only; the header
 * carries the one real duration we have (created → completed).
 */
export function buildTimeline(d: TimelineInput): Timeline {
  const totalMs = d.completedAt
    ? new Date(d.completedAt).getTime() - new Date(d.createdAt).getTime()
    : null;
  const err = d.errorMessage?.trim() || null;
  const allDone = [
    p("init", "Initialization", "done"),
    p("build", "Build", "done"),
    p("deploy", "Deploy", "done"),
    p("run", "Post-deploy", "done"),
  ];

  switch (d.status) {
    case "running":
      return runningTimeline(d.taskCount, d.runningTaskCount, totalMs);
    case "starting":
      // Image built; containers are coming up (pre-running). The deploy phase
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
      return failedTimeline(d.taskCount, err, totalMs);
    case "crashed":
      // Built + deployed fine, but the container keeps exiting and restarting
      // (e.g. a bad env var): the run phase is the one that's failing.
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
    case "paused":
      // Deployed cleanly, then scaled to zero on purpose. Every phase ran, it
      // just isn't serving right now.
      return { title: "Paused. Scaled to zero", tone: "neutral", totalMs, phases: allDone };
    case "superseded":
      // A benign replacement: this deploy was live/building when a newer one
      // took over (a FAILED deploy keeps its `failed` status, never lands here).
      return { title: "Replaced by a newer deployment", tone: "neutral", totalMs, phases: allDone };
    default:
      return { title: "Removed", tone: "neutral", totalMs, phases: allDone };
  }
}
