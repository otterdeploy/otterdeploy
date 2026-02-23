import { createLogger } from "@otterdeploy/logger";

import type { WebhookEvent } from "./types";

const log = createLogger("git:auto-deploy");

export interface AutoDeployMatch {
  resourceId: string;
  gitRepositoryId: string;
  environmentId: string;
  projectId: string;
}

export interface AutoDeployOpts {
  event: WebhookEvent;
  findMatchingRepos: (
    owner: string,
    name: string,
    branch: string,
  ) => Promise<AutoDeployMatch[]>;
  shouldDeploy: (
    match: AutoDeployMatch,
    changedFiles: string[],
  ) => Promise<boolean>;
}

/**
 * Resolve which resources should be auto-deployed based on a webhook event.
 *
 * Matches the webhook event's repo+branch to database records, then filters
 * each match through watch paths to determine if a deploy is warranted.
 */
export async function resolveAutoDeployTargets(
  opts: AutoDeployOpts,
): Promise<AutoDeployMatch[]> {
  const { event, findMatchingRepos, shouldDeploy } = opts;

  if (event.type !== "push") {
    log.debug(
      { type: event.type },
      "skipping non-push event for auto-deploy",
    );
    return [];
  }

  const matches = await findMatchingRepos(
    event.repository.owner,
    event.repository.name,
    event.branch,
  );

  if (matches.length === 0) {
    log.debug(
      {
        repo: event.repository.fullName,
        branch: event.branch,
      },
      "no matching repositories found for auto-deploy",
    );
    return [];
  }

  log.info(
    {
      repo: event.repository.fullName,
      branch: event.branch,
      candidateCount: matches.length,
    },
    "found candidate auto-deploy targets",
  );

  const deployTargets: AutoDeployMatch[] = [];

  for (const match of matches) {
    const deploy = await shouldDeploy(match, event.changedFiles);
    if (deploy) {
      deployTargets.push(match);
    }
  }

  log.info(
    {
      repo: event.repository.fullName,
      deployCount: deployTargets.length,
    },
    "resolved auto-deploy targets",
  );

  return deployTargets;
}
