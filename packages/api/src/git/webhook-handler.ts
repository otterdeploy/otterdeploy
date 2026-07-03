/**
 * GitHub App webhook event dispatcher.
 *
 * Pure: takes a parsed event + delivery metadata, mutates DB, returns a
 * structured result. Signature verification and raw-body handling live at
 * the HTTP edge (apps/server/src/webhooks/github.ts) so this module stays
 * unit-testable.
 *
 * Each event has its own handler file — see ./handle-* siblings.
 */

import type {
  GithubWebhookResult,
  InstallationEvent,
  InstallationReposEvent,
  PullRequestEvent,
  PushEvent,
} from "./types";

import { handleInstallation } from "./handle-installation";
import { handleInstallationRepos } from "./handle-installation-repos";
import { handlePullRequest } from "./handle-pull-request";
import { handlePush } from "./handle-push";

export type { GithubWebhookResult };

interface HandleArgs {
  event: string;
  /** Parsed JSON body. */
  payload: unknown;
  /** GitHub delivery id — for log correlation. */
  deliveryId: string;
}

export async function handleGithubWebhook({
  event,
  payload,
  deliveryId,
}: HandleArgs): Promise<GithubWebhookResult> {
  switch (event) {
    case "installation":
      return handleInstallation(payload as InstallationEvent, deliveryId);
    case "installation_repositories":
      return handleInstallationRepos(payload as InstallationReposEvent, deliveryId);
    case "push":
      return handlePush(payload as PushEvent, deliveryId);
    case "pull_request":
      return handlePullRequest(payload as PullRequestEvent, deliveryId);
    default:
      return { kind: "ignored", event };
  }
}
