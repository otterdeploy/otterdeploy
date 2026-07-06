/**
 * Sticky PR-comment body for preview environments — the Vercel-style status
 * table. Pure string building over a pre-loaded snapshot (see
 * preview-report-state.ts), so it's trivially unit-testable and GitHub-API
 * free. One row per (project, service) the PR rebuilds.
 */

export type PreviewRowStatus =
  | "queued"
  | "building"
  | "ready"
  | "failed"
  | "superseded"
  | "removed";

export interface PreviewCommentRow {
  /** Prefixes the service name when the PR spans several projects. */
  projectName: string;
  serviceName: string;
  status: PreviewRowStatus;
  /** Dashboard deployment page (build logs + timeline). */
  inspectUrl: string | null;
  /** The preview host, https-qualified. Null until a route exists. */
  previewUrl: string | null;
  updatedAt: Date | null;
}

export interface PreviewCommentState {
  prNumber: number;
  headSha: string;
  rows: PreviewCommentRow[];
  tornDown: boolean;
}

const STATUS_LABEL: Record<PreviewRowStatus, string> = {
  queued: "⚪ Queued",
  building: "🟠 Building",
  ready: "🟢 Ready",
  failed: "🔴 Failed",
  superseded: "⚪ Superseded",
  removed: "⚪ Removed",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** `Jul 6, 2026 3:38pm` — Vercel's comment format, always UTC. */
export function formatUpdatedUtc(date: Date): string {
  const month = MONTHS[date.getUTCMonth()];
  const hours24 = date.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const meridiem = hours24 < 12 ? "am" : "pm";
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()} ${hours12}:${minutes}${meridiem}`;
}

function nameCell(row: PreviewCommentRow, multiProject: boolean): string {
  const name = multiProject ? `${row.projectName} / ${row.serviceName}` : row.serviceName;
  return `**${name}**`;
}

function statusCell(row: PreviewCommentRow): string {
  const label = STATUS_LABEL[row.status];
  return row.inspectUrl ? `${label} ([Inspect](${row.inspectUrl}))` : label;
}

function previewCell(row: PreviewCommentRow): string {
  if (!row.previewUrl) return "—";
  // A preview link is only meaningful once (or while) the deployment serves.
  if (row.status !== "ready" && row.status !== "building") return "—";
  return `[Visit Preview](${row.previewUrl})`;
}

/** Render the sticky comment. The marker is prepended by upsertPrComment. */
export function renderPreviewComment(state: PreviewCommentState): string {
  const shortSha = state.headSha.slice(0, 7);

  if (state.tornDown) {
    return [
      `**Preview environment** for PR #${state.prNumber} has been torn down.`,
      "",
      `<sub>Containers, preview hosts and branched databases were removed. Reopen the PR to rebuild it.</sub>`,
    ].join("\n");
  }

  const multiProject = new Set(state.rows.map((r) => r.projectName)).size > 1;
  const header = multiProject ? "Project" : "Service";
  const lines = [
    "**The latest updates on your preview environment.**",
    "",
    `| ${header} | Status | Preview | Updated (UTC) |`,
    "| :--- | :--- | :--- | :--- |",
    ...state.rows.map((row) =>
      [
        `| ${nameCell(row, multiProject)}`,
        statusCell(row),
        previewCell(row),
        `${row.updatedAt ? formatUpdatedUtc(row.updatedAt) : "—"} |`,
      ].join(" | "),
    ),
    "",
    `<sub>Deploying commit \`${shortSha}\` · otterdeploy updates this comment as deployments progress.</sub>`,
  ];
  return lines.join("\n");
}

/** deployment.status → comment row status. "Success" is `running` in the
 *  deployment state machine; a missing row means the webhook queued it but
 *  the builder hasn't picked it up yet. */
export function rowStatusFromDeployment(status: string | null | undefined): PreviewRowStatus {
  switch (status) {
    case "building":
      return "building";
    case "running":
      return "ready";
    case "failed":
      return "failed";
    case "superseded":
      return "superseded";
    case "removed":
      return "removed";
    default:
      return "queued";
  }
}
