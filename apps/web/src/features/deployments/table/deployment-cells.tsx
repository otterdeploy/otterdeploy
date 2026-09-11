/**
 * How a deployment READS.
 *
 * What makes this table different from the three log surfaces beside it: a
 * deployment is not an event, it is a PROCESS with a lifetime. `pending` and
 * `building` are not history — they are happening now, and the row has to say
 * so, which is why the status carries a live elapsed clock rather than a
 * finished duration.
 *
 * The vocabulary is the stored one, verbatim: `superseded`, not "Replaced".
 * The old page translated it, and that was defensible when the status was a
 * `<Select>` of five hand-written labels. On the shell the same value shows up
 * in the cell, in the facet list with its count, in the histogram legend and in
 * the URL — and a word that changes spelling between those four is a word you
 * cannot search for.
 */

import type { ProjectDeployment } from "@/features/deployments/data/deployments-search";
import type { BadgeTone } from "@/shared/components/data-table/schema/types";

import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar";
import { formatDuration, useNowTick } from "@/shared/lib/duration";
import { cn } from "@/shared/lib/utils";

/**
 * A feed row: the wire shape plus the two DERIVED keys.
 *
 * They travel on the row rather than being computed per render because they
 * are filter keys — the server compiles them from SQL expressions and the
 * client evaluator reads them off the row, and the two only agree if the value
 * itself makes the trip. Same arrangement as the firewall feed's `state`.
 */
export interface DeploymentRow extends ProjectDeployment {
  /** `succeeded` | `in flight` | `cancelled` | `failed` — see {@link outcomeOf}. */
  outcome: string;
  /** Wall time in ms, or null for a row that never recorded a completion. */
  durationMs: number | null;
  /**
   * The commit author's avatar.
   *
   * NOT derived — the server has been sending this all along (see
   * `deployments-list.ts`'s `gitCommitAuthorAvatar`), and the client row type
   * simply never declared it, so the old table dropped it and rendered a bare
   * name. Declared here until the contract's list item is widened.
   */
  gitCommitAuthorAvatar: string | null;
}

/** Still moving. Everything else has settled, one way or another. */
const IN_FLIGHT = new Set(["pending", "building", "starting"]);

export function isInFlight(status: string): boolean {
  return IN_FLIGHT.has(status);
}

/**
 * Ten stored statuses, four outcomes.
 *
 * The histogram asks one question — "did the deploys in this window work" —
 * and ten stacked bands is a gradient, not an answer. `cancelled` is kept out
 * of `failed` on purpose: a build somebody stopped is not a build that broke,
 * and folding the two together is how a quiet afternoon of cancelled retries
 * reads as an incident.
 */
export function outcomeOf(status: string): string {
  if (status === "failed" || status === "crashed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (isInFlight(status)) return "in flight";
  return "succeeded";
}

export const DEPLOYMENT_OUTCOME_TONES: Record<string, string> = {
  succeeded: "var(--chart-band-ok)",
  "in flight": "var(--chart-band-info)",
  cancelled: "var(--chart-band-warn)",
  failed: "var(--chart-band-bad)",
};

/** Bottom-first: the ordinary outcome sits under the ones worth looking at. */
export const DEPLOYMENT_OUTCOME_ORDER = ["succeeded", "in flight", "cancelled", "failed"] as const;

/**
 * `running` is the only live success, and only one row per resource has it.
 *
 * `superseded` and `removed` are deliberately neutral, not failures: they mean
 * a newer deploy replaced this one, which is the ordinary result of shipping
 * again and should not read as something that went wrong.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  running: "success",
  starting: "info",
  building: "info",
  pending: "neutral",
  paused: "warning",
  cancelled: "warning",
  failed: "danger",
  crashed: "danger",
  superseded: "neutral",
  removed: "neutral",
};

function deploymentStatusTone(value: unknown): BadgeTone {
  return STATUS_TONE[String(value)] ?? "neutral";
}

/** Dot colours, matching the shared tones. */
const TONE_DOT: Record<BadgeTone, string> = {
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

/**
 * What state this deployment is in. Only that.
 *
 * It used to print the duration beside the status — "superseded · 3m 21s" —
 * borrowed from the firewall's status cell, where the fold is right because
 * "banned, 25d 23h to go" really is one fact: the remaining time is a property
 * of the ban. A build's duration is not a property of `superseded`. It is an
 * independent measurement, read DOWN the column against the last ten builds,
 * and buried mid-cell behind a status word of varying length it was ragged,
 * unsortable and unscannable — while a `durationMs` column carrying the very
 * same number sat hidden one menu away. Two concerns, two columns.
 */
export function DeploymentStatus({ row }: { row: DeploymentRow }) {
  const tone = deploymentStatusTone(row.status);
  return (
    <span className="flex items-center gap-1.5 truncate">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          TONE_DOT[tone],
          // A pulse only while something is actually happening. On a settled
          // row it would be decoration pretending to be activity.
          isInFlight(row.status) && "motion-safe:animate-pulse",
        )}
      />
      <span className="truncate font-mono text-[12px]">{row.status}</span>
    </span>
  );
}

/**
 * How long it took, or how long it has been going.
 *
 * An in-flight deploy counts UP, live: "2m 14s…" and climbing is the difference
 * between a build that is working and one that is wedged, and a frozen number
 * cannot tell you which you have. This is the one cell in the app on a
 * one-second tick rather than the table's shared 15s one, because a build clock
 * advancing in fifteen-second jumps looks broken. The cost is bounded — the
 * timer only runs while a row on screen is actually in flight, and
 * virtualization means that is a handful of rows at most.
 *
 * The dash is load-bearing. Old rows settled without recording a completion,
 * and the tempting fix — measuring to `updatedAt`, or to now — would invent a
 * duration that reads exactly like a measured one. A dash says "not recorded",
 * which is true.
 */
export function DeploymentDuration({ row }: { row: DeploymentRow }) {
  const running = isInFlight(row.status);
  const now = useNowTick(running);

  if (row.durationMs !== null) {
    return <span className="tabular-nums">{formatDuration(row.durationMs)}</span>;
  }
  if (running) {
    return (
      <span className="text-foreground tabular-nums">
        {formatDuration(now - Date.parse(row.createdAt))}…
      </span>
    );
  }
  return <span className="text-muted-foreground/60">—</span>;
}

/**
 * Who wrote the commit.
 *
 * Through `Avatar` rather than the bare `<img>` the detail panel uses: these
 * URLs are third-party — GitHub, GitLab, a self-hosted Gitea — and one that
 * 404s renders a broken-image glyph. Tolerable once in a detail panel; a column
 * of them in a two-hundred-row table is not. The fallback initial covers a dead
 * URL and a missing one through the same path.
 */
export function DeploymentAuthor({ row }: { row: DeploymentRow }) {
  const name = row.gitCommitAuthor;
  if (name === null) return <span className="text-muted-foreground/60">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar size="sm" className="size-4">
        {row.gitCommitAuthorAvatar === null ? null : (
          <AvatarImage src={row.gitCommitAuthorAvatar} alt="" />
        )}
        <AvatarFallback className="text-[9px]">{name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="truncate" title={name}>
        {name}
      </span>
    </span>
  );
}

/**
 * The service, and whether this row is the one currently on it.
 *
 * `current` is the single most valuable bit on the page and the cheapest to
 * lose: in a list sorted by time, the running deployment of a service you
 * deployed twice this morning is not the top row, and without the marker there
 * is nothing distinguishing it from the two above it.
 */
export function DeploymentResource({ row }: { row: DeploymentRow }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono text-[12px]" title={row.resourceName}>
        {row.resourceName}
      </span>
      {isCurrent(row) ? (
        <span className="shrink-0 rounded-[3px] bg-success/15 px-1 font-mono text-[9px] tracking-[0.08em] text-success">
          current
        </span>
      ) : null}
    </span>
  );
}

/**
 * Statuses under which the newest row IS the resource's live deployment.
 * A newest row that failed or was removed has nothing running to be current of.
 */
const CURRENT_STATUSES = new Set(["running", "starting", "crashed", "paused"]);

function isCurrent(row: DeploymentRow): boolean {
  return row.isLatest && CURRENT_STATUSES.has(row.status);
}
