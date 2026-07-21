/**
 * Shapes of the GitHub webhook payloads we read fields off of.
 *
 * Intentionally narrow — the real payloads are huge and we don't want a
 * type-level dependency on the full Octokit types. Anything we ever want
 * to read must be listed here so handlers stay typed end-to-end.
 */

export interface GithubRepoPayload {
  id: number | string;
  node_id?: string;
  full_name: string;
  name: string;
  private?: boolean;
  default_branch?: string;
  clone_url?: string;
}

export interface GithubAccountPayload {
  id: number | string;
  login: string;
  type: string;
  avatar_url?: string;
}

export interface InstallationEvent {
  action: string;
  installation: {
    id: number | string;
    account: GithubAccountPayload;
    repository_selection: "all" | "selected";
    permissions?: Record<string, string>;
  };
  repositories?: GithubRepoPayload[];
}

export interface InstallationReposEvent {
  action: string;
  installation: { id: number | string };
  repositories_added?: GithubRepoPayload[];
  repositories_removed?: GithubRepoPayload[];
}

/** A single commit in a push payload. `added`/`removed`/`modified` are
 *  repo-root-relative paths — GitHub omits them on very large pushes, so
 *  treat an absent/empty list as "unknown", not "nothing changed". */
export interface GithubCommitPayload {
  id: string;
  message: string;
  author?: { name?: string; email?: string };
  added?: string[];
  removed?: string[];
  modified?: string[];
}

export interface PushEvent {
  ref: string;
  after: string;
  deleted?: boolean;
  repository: GithubRepoPayload;
  installation?: { id: number | string };
  head_commit?: GithubCommitPayload;
  commits?: GithubCommitPayload[];
  /** The GitHub user who pushed — carries their `avatar_url` + `login`, which
   *  the deployment card shows as the author's face. */
  sender?: GithubAccountPayload;
}

/** `pull_request` webhook — drives preview environments. We read the action
 *  (opened/reopened/synchronize/closed), the PR number + node id, and the head
 *  ref/sha to build from. See docs/designs/pr-previews.md §7. */
export interface PullRequestEvent {
  action: string;
  number: number;
  pull_request: {
    number: number;
    node_id?: string;
    state: "open" | "closed";
    merged?: boolean;
    title?: string;
    head: { ref: string; sha: string };
    base: { ref: string };
  };
  repository: GithubRepoPayload;
  installation?: { id: number | string };
}

export type GithubWebhookResult =
  | { kind: "ignored"; event: string }
  | { kind: "installation"; action: string; installationId: string }
  | { kind: "installation_repositories"; added: number; removed: number }
  | {
      kind: "push";
      ref: string;
      sha: string;
      deploymentsCreated: number;
      projectsTouched: number;
    }
  | {
      kind: "pull_request";
      action: string;
      prNumber: number;
      outcome: "preview-deployed" | "preview-closed" | "ignored";
      environmentsTouched: number;
      deploymentsCreated: number;
    };
