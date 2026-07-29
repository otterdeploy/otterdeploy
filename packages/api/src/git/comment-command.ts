/**
 * `@otterdeploy <command>` in a pull-request comment.
 *
 * Exists so a repository with automatic previews turned OFF can still ask for
 * one on demand. Everything downstream — branch, build, route, comment,
 * teardown — is the path the `pull_request` webhook already drives; this only
 * decides whether a comment is a request and whether its author may make it.
 *
 * **This is an authorization boundary, not a convenience.** Anyone who can see
 * a public repository can comment on its pull requests. Without the association
 * check below, `@otterdeploy preview` is an unauthenticated request to
 * provision compute and clone a database on someone else's infrastructure.
 * Parsing and authorization are pure and live here precisely so both can be
 * tested without a webhook.
 */

/** Commands the bot answers to. Deliberately tiny — every addition is another
 *  thing a commenter can make the platform do. */
export type CommentCommand = "preview";

/**
 * GitHub's `author_association` values that may trigger work.
 *
 * Write access or better. `CONTRIBUTOR` means "has had a PR merged at some
 * point", which is not write access and is a low bar for spending someone
 * else's disk and CPU; `NONE`, `FIRST_TIME_CONTRIBUTOR` and
 * `FIRST_TIME_CONTRIBUTOR`-adjacent values are drive-by commenters on a public
 * repository. `MANNEQUIN` and `BOT` are excluded too — a bot echoing a command
 * would be a trivial amplification loop.
 */
const ALLOWED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * Is this comment a command for us?
 *
 * Requires the mention to start a line so a command cannot be smuggled inside
 * prose ("we should not run @otterdeploy preview here" is a sentence, not an
 * instruction). Leading whitespace and blockquote markers are tolerated because
 * GitHub's reply-quoting adds them; a quoted command in a reply is still a
 * deliberate act by the person replying.
 */
export function parseCommentCommand(body: string | null | undefined): CommentCommand | null {
  if (!body) return null;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s>]+/, "").trim();
    const match = /^@otterdeploy\s+([a-z-]+)\b/i.exec(line);
    if (!match) continue;
    const command = match[1]?.toLowerCase();
    if (command === "preview") return "preview";
  }
  return null;
}

/** May this commenter trigger work on the repository? */
export function isAuthorizedCommenter(association: string | null | undefined): boolean {
  return association != null && ALLOWED_ASSOCIATIONS.has(association.toUpperCase());
}

/**
 * Why a command was refused, for the log. Deliberately NOT posted as a reply:
 * a bot that answers every unauthorized mention can be made to spam a thread by
 * anyone with a keyboard. The webhook reacts to the comment instead, which is
 * visible to the author and silent to everyone else.
 */
export function refusalReason(association: string | null | undefined): string {
  return `comment author association ${association ?? "unknown"} lacks write access`;
}
