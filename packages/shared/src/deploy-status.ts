/**
 * How a listed deployment is bucketed and attributed, shared by the API (which
 * counts and filters the project deployments feed) and the web (which renders
 * and narrows it). One definition on both sides is the point: the summary that
 * says "Failed 0" and the row painted as failed used to come from two separate
 * derivations, and disagreed.
 */

/** Every status a listed deployment can carry: the stored lifecycle values
 *  plus the derived-only runtime states (`starting`, `crashed`, `paused`). */
export type ListedDeployStatus =
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

/**
 * The three buckets the page filters and counts by.
 *
 * - `in-progress`: still on its way (queued, building, containers coming up).
 * - `failed`: it broke, whether the pipeline gave up or the container keeps
 *   dying after it came up. Both are what "show me what failed" is asking for.
 * - `settled`: everything else. Whether a settled row is the one a resource is
 *   serving is a separate fact (`isServing`), not a status.
 */
export type DeployStatusGroup = "in-progress" | "failed" | "settled";

export function deployStatusGroup(status: ListedDeployStatus): DeployStatusGroup {
  switch (status) {
    case "pending":
    case "building":
    case "starting":
      return "in-progress";
    case "failed":
    case "crashed":
      return "failed";
    default:
      return "settled";
  }
}

/** The fields who-did-this is read from. */
export interface DeployActorInput {
  reason: string;
  /** The person who asked for the deployment by hand; null for a push or a key. */
  triggeredBy: { name: string; image: string | null } | null;
  gitCommitAuthor: string | null;
  gitCommitAuthorAvatar: string | null;
}

/**
 * Who a deployment is credited to.
 *
 * The person who asked for it wins: Ada rolling back Marcus's commit is Ada's
 * rollback. With nobody behind it, a push is credited to the commit's author
 * (the push is what they did). Anything else with no person behind it (an API
 * key, an automation) is `automatic`, never a person it would misattribute.
 */
export type DeployActor =
  | { kind: "person"; name: string; image: string | null; via: "triggered" | "pushed" }
  | { kind: "automatic" };

export function deployActor(d: DeployActorInput): DeployActor {
  if (d.triggeredBy) {
    return {
      kind: "person",
      name: d.triggeredBy.name,
      image: d.triggeredBy.image,
      via: "triggered",
    };
  }
  if (d.reason === "git-push" && d.gitCommitAuthor) {
    return {
      kind: "person",
      name: d.gitCommitAuthor,
      image: d.gitCommitAuthorAvatar,
      via: "pushed",
    };
  }
  return { kind: "automatic" };
}
