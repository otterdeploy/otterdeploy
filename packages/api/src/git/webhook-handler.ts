/**
 * GitHub App webhook event dispatcher.
 *
 * Pure: takes a parsed event + delivery metadata, mutates DB, returns a
 * structured result. Signature verification and raw-body handling live at
 * the HTTP edge (apps/server/src/webhooks/github.ts) so this module stays
 * unit-testable.
 *
 * Each event has its own handler file. See ./handle-* siblings.
 */

import { isJsonObject } from "@otterdeploy/shared/json";
import * as z from "zod";

import type {
  GithubWebhookResult,
  InstallationEvent,
  InstallationReposEvent,
  IssueCommentEvent,
  PullRequestEvent,
  PushEvent,
} from "./types";

import { handleInstallation } from "./handle-installation";
import { handleInstallationRepos } from "./handle-installation-repos";
import { handleIssueComment } from "./handle-issue-comment";
import { handlePullRequest } from "./handle-pull-request";
import { handlePush } from "./handle-push";

// GitHub authenticates each delivery with an HMAC signature (verified at the
// HTTP edge before this dispatcher runs) and names the payload's shape via the
// `x-github-event` header the switch below routes on. The event interfaces in
// ./types are deliberately narrow views of those huge payloads, so the one
// structural fact validated here is object-ness (the same `z.custom` +
// `isJsonObject` idiom as `zJsonObject` in lib/z-json.ts). A non-object body
// fails `.parse` and surfaces through the caller's existing error path instead
// of crashing inside a field access in a handler.
const installationEvent = z.custom<InstallationEvent>(isJsonObject);
const installationReposEvent = z.custom<InstallationReposEvent>(isJsonObject);
const pushEvent = z.custom<PushEvent>(isJsonObject);
const pullRequestEvent = z.custom<PullRequestEvent>(isJsonObject);
const issueCommentEvent = z.custom<IssueCommentEvent>(isJsonObject);

export type { GithubWebhookResult };

interface HandleArgs {
  event: string;
  /** Parsed JSON body. */
  payload: unknown;
  /** GitHub delivery id: for log correlation. */
  deliveryId: string;
}

export async function handleGithubWebhook({
  event,
  payload,
  deliveryId,
}: HandleArgs): Promise<GithubWebhookResult> {
  switch (event) {
    case "installation":
      return handleInstallation(installationEvent.parse(payload), deliveryId);
    case "installation_repositories":
      return handleInstallationRepos(installationReposEvent.parse(payload), deliveryId);
    case "push":
      return handlePush(pushEvent.parse(payload), deliveryId);
    case "pull_request":
      return handlePullRequest(pullRequestEvent.parse(payload), deliveryId);
    case "issue_comment":
      return handleIssueComment(issueCommentEvent.parse(payload), deliveryId);
    default:
      return { kind: "ignored", event };
  }
}
