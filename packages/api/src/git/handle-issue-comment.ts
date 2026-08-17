/**
 * `issue_comment` webhook: the on-demand `@otterdeploy preview` trigger.
 *
 * Lets a repository with automatic previews turned OFF ask for one anyway. It
 * resolves the pull request the comment sits on, then hands off to the SAME
 * `deployPreviews` path the `pull_request` webhook uses, so branch, build,
 * route, comment, cap and teardown all behave identically. Nothing about a
 * comment-triggered preview is special once it exists.
 *
 * Order of checks is deliberate. Cheapest and most-restrictive first, so a
 * drive-by comment on a public repository costs a regex and nothing else:
 *
 *   1. Is it a PR comment at all (not a plain issue)?
 *   2. Is it our command?
 *   3. May this author trigger work?           ← the authorization boundary
 *   4. Is the repo bound to a project?
 *   5. …only then talk to GitHub or the runtime.
 */
import type { GitRepoId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitRepo, project, resource, serviceResource } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { log } from "evlog";

import type { GithubWebhookResult, IssueCommentEvent, PullRequestEvent } from "./types";

import { isAuthorizedCommenter, parseCommentCommand, refusalReason } from "./comment-command";
import { fetchPullRequestHead, type PullRequestHead } from "./github-pulls";
import { deployPreviews } from "./handle-pull-request";

/**
 * Is this comment a preview request we are willing to act on?
 *
 * Split out so the handler stays under its complexity cap, and so the
 * authorization decision reads as one thing rather than three guards buried in
 * a longer function.
 */
function shouldTrigger(ev: IssueCommentEvent, deliveryId: string): boolean {
  // Edits and deletions must not re-trigger: editing an old comment to add the
  // command would otherwise be a way to replay it indefinitely.
  if (ev.action !== "created") return false;
  // `issue.pull_request` is present only when the issue IS a pull request.
  if (!ev.issue?.pull_request) return false;
  if (!parseCommentCommand(ev.comment?.body)) return false;

  if (!isAuthorizedCommenter(ev.comment?.author_association)) {
    // Refused silently to the thread on purpose. A bot that replies to every
    // unauthorized mention can be made to spam a pull request by anyone with a
    // keyboard; the operator sees this in the log instead.
    log.info({
      github: {
        event: "issue_comment",
        deliveryId,
        repo: ev.repository?.full_name,
        prNumber: ev.issue.number,
      },
      msg: `preview command refused: ${refusalReason(ev.comment?.author_association)}`,
    });
    return false;
  }
  return true;
}

/** The projects that own a git service bound to this repo. Same binding rule as
 *  the pull_request path. */
async function projectsForRepo(repoId: GitRepoId) {
  const projectIdRows = await db
    .selectDistinct({ id: resource.projectId })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .where(and(eq(serviceResource.gitRepoId, repoId), isNull(serviceResource.stackId)));
  if (projectIdRows.length === 0) return [];
  return db
    .select()
    .from(project)
    .where(
      inArray(
        project.id,
        projectIdRows.map((r) => r.id),
      ),
    );
}

/**
 * The `issue_comment` payload has no pull request, so a comment-triggered
 * preview runs off a synthetic `pull_request` event built from the PR lookup.
 * Carried metadata included, so a `/preview` comment produces the same card as
 * a webhook-opened PR rather than an anonymous one.
 */
function syntheticPullRequestEvent(ev: IssueCommentEvent, head: PullRequestHead): PullRequestEvent {
  return {
    action: "synchronize",
    number: ev.issue.number,
    pull_request: {
      number: ev.issue.number,
      node_id: head.nodeId ?? undefined,
      state: "open",
      title: head.title ?? undefined,
      user: {
        login: head.authorLogin ?? undefined,
        avatar_url: head.authorAvatarUrl ?? undefined,
      },
      html_url: head.url ?? undefined,
      head: { ref: head.ref, sha: head.sha },
      base: { ref: "" },
    },
    repository: ev.repository,
  };
}

export async function handleIssueComment(
  ev: IssueCommentEvent,
  deliveryId: string,
): Promise<GithubWebhookResult> {
  const ignored: GithubWebhookResult = { kind: "ignored", event: "issue_comment" };

  if (!shouldTrigger(ev, deliveryId)) return ignored;

  const providerRepoId = String(ev.repository?.node_id ?? ev.repository?.id ?? "");
  if (!providerRepoId) return ignored;
  const [repo] = await db
    .select()
    .from(gitRepo)
    .where(eq(gitRepo.providerRepoId, providerRepoId))
    .limit(1);
  if (!repo) return ignored;

  const projects = await projectsForRepo(repo.id);
  if (projects.length === 0) return ignored;

  // The comment payload carries the issue, not the pull request, so the head
  // to build has to be resolved from the API.
  // `fullName` is always "owner/name"; destructuring with defaults keeps the
  // tuple typed without asserting on `split`'s unbounded array.
  const [repoOwner = "", repoName = ""] = repo.fullName.split("/");
  const head = await Result.tryPromise({
    try: () => fetchPullRequestHead(repo.installationId, repoOwner, repoName, ev.issue.number),
    catch: (cause) => cause,
  });
  if (head.isErr()) {
    log.warn({
      github: { event: "issue_comment", deliveryId, prNumber: ev.issue.number },
      err: head.error,
    });
    return ignored;
  }
  // A command on a merged or closed PR would provision compute for something
  // nobody is reviewing, and the close handler has already torn its preview
  // down.
  if (head.value.state !== "open") return ignored;

  // Deliberately NOT filtered by `previewsEnabled`: the whole point of the
  // command is to get a preview for a repository that has not opted in. The
  // cap still applies, inside deployPreviews.
  const synthetic = syntheticPullRequestEvent(ev, head.value);

  log.info({
    github: {
      event: "issue_comment",
      deliveryId,
      repo: repo.fullName,
      prNumber: ev.issue.number,
    },
    msg: "preview requested by comment",
  });
  return deployPreviews(synthetic, repo, projects);
}
