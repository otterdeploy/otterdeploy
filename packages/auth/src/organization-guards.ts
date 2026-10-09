/**
 * Guards around two better-auth organization endpoints the dashboard and the
 * CLI call directly (so the oRPC middleware never sees them).
 *
 * ## A refused switch leaves the session where it was
 *
 * `/organization/set-active` for an organization the caller does not belong
 * to (a stale switcher entry after a removal, a mistyped id, an organization
 * deleted meanwhile) CLEARS the session's active organization before it
 * answers 403 (better-auth crud-org `setActiveOrganization`). The session is
 * then left with no workspace, and every org-scoped call fails until the user
 * signs out and back in. The membership check runs here first, so a refused
 * switch is refused without touching the session.
 *
 * ## An invitation is sent once
 *
 * `/organization/invite-member` sent twice at once (a double click), or again
 * after the client lost the first answer, made two pending invitations and
 * sent two emails. The first request claims (organization, email, role) for a
 * short window; an identical one inside it is refused with a 409. A request
 * that fails gives the claim back, so a corrected resubmit is not refused. An
 * explicit `resend: true` is exempt: it refreshes the one pending invitation.
 */
import type { BetterAuthPlugin } from "better-auth";

import { db } from "@otterdeploy/db";
import { claimRequest, releaseRequest } from "@otterdeploy/db/request-claim";
import { member, organization, session as sessionTbl } from "@otterdeploy/db/schema/auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { parseCookies } from "better-auth/cookies";
import { Result } from "better-result";
import { and, eq, gt, sql } from "drizzle-orm";
import * as z from "zod";

export const SET_ACTIVE_ORGANIZATION_PATH = "/organization/set-active";
export const INVITE_MEMBER_PATH = "/organization/invite-member";

/** How long an invitation claims its (organization, email, role) for. */
export const INVITATION_CREATE_WINDOW_SECONDS = 30;

const setActiveBody = z.object({
  organizationId: z.string().nullish(),
  organizationSlug: z.string().optional(),
});

const inviteBody = z.object({
  email: z.string(),
  role: z.union([z.string(), z.array(z.string())]),
  organizationId: z.string().optional(),
  resend: z.boolean().optional(),
});

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** A cookie or header value, percent-decoded when it is encoded; a malformed
 *  escape is left as sent (it then matches no session) rather than thrown. */
function decoded(value: string): string {
  const attempt = Result.try(() => decodeURIComponent(value));
  return attempt.isOk() ? attempt.value : value;
}

/** The token a request authenticates with: a bearer header (the CLI, the API
 *  tests) or the session cookie (the dashboard). Signed values carry the
 *  token before the dot. */
function sessionTokenOf(ctx: HookContext): string | null {
  const authorization = ctx.headers?.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const bearer = decoded(authorization.slice(7).trim());
    if (bearer) return bearer.split(".")[0] ?? null;
  }
  const cookie = ctx.headers?.get("cookie");
  if (!cookie) return null;
  const signed = parseCookies(cookie).get(ctx.context.authCookies.sessionToken.name);
  return signed ? (decoded(signed).split(".")[0] ?? null) : null;
}

/**
 * The caller's live session, read straight from the session table. A before
 * hook cannot use `getSessionFromCtx`: the bearer plugin's own before hook
 * turns `Authorization: Bearer` into a session cookie, but better-auth merges
 * what the before hooks return only after all of them ran, so here a bearer
 * caller would look signed out. Holding a live token is what the session
 * endpoints check too; the endpoint still authenticates the request itself.
 */
async function callerSession(ctx: HookContext) {
  const token = sessionTokenOf(ctx);
  if (!token) return null;
  const [row] = await db
    .select({ userId: sessionTbl.userId, activeOrganizationId: sessionTbl.activeOrganizationId })
    .from(sessionTbl)
    .where(and(eq(sessionTbl.token, token), gt(sessionTbl.expiresAt, sql`now()`)))
    .limit(1);
  return row ?? null;
}

async function isMemberOf(userId: string, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}

/** The organization a set-active body names, when it names one that exists;
 *  null for "clear it", "keep the current one" or an unknown slug (better-auth
 *  answers those itself without clearing anything). */
async function targetOrganizationOf(body: z.infer<typeof setActiveBody>): Promise<string | null> {
  if (body.organizationId) return body.organizationId;
  if (body.organizationId === null || !body.organizationSlug) return null;
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, body.organizationSlug))
    .limit(1);
  return row?.id ?? null;
}

const refuseNonMemberSwitch = createAuthMiddleware(async (ctx) => {
  const body = setActiveBody.safeParse(ctx.body);
  if (!body.success) return;
  const target = await targetOrganizationOf(body.data);
  if (target === null) return;
  const session = await callerSession(ctx);
  // No session: the endpoint's own session middleware answers 401.
  if (!session) return;
  if (await isMemberOf(session.userId, target)) return;
  throw new APIError("FORBIDDEN", {
    code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
    message: "You are not a member of this organization.",
  });
});

/** The claim key of an invite request, or null when the request is not one
 *  this guard can name (no session, a body the endpoint will refuse anyway). */
async function inviteClaimKey(ctx: HookContext) {
  const body = inviteBody.safeParse(ctx.body);
  // An explicit resend refreshes the pending invitation and mails it again;
  // it never makes a second one, so it is not a duplicate to refuse.
  if (!body.success || body.data.resend === true) return null;
  const session = await callerSession(ctx);
  const organizationId = body.data.organizationId ?? session?.activeOrganizationId;
  if (!session || !organizationId) return null;
  const roles = [body.data.role]
    .flat()
    .join(",")
    .split(",")
    .map((role) => role.trim());
  return `invitation.create:${organizationId}:${body.data.email.trim().toLowerCase()}:${roles.toSorted().join(",")}`;
}

const claimInvite = createAuthMiddleware(async (ctx) => {
  const key = await inviteClaimKey(ctx);
  if (key === null) return;
  if (await claimRequest(key, INVITATION_CREATE_WINDOW_SECONDS)) return;
  throw new APIError("CONFLICT", {
    code: "INVITATION_JUST_SENT",
    message:
      "An invitation to this address was sent moments ago. It is in the pending invitations list.",
  });
});

const releaseFailedInvite = createAuthMiddleware(async (ctx) => {
  if (!(ctx.context.returned instanceof APIError)) return;
  const key = await inviteClaimKey(ctx);
  if (key !== null) await releaseRequest(key);
});

export function organizationGuards() {
  return {
    id: "otterdeploy-organization-guards",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === SET_ACTIVE_ORGANIZATION_PATH,
          handler: refuseNonMemberSwitch,
        },
        { matcher: (ctx) => ctx.path === INVITE_MEMBER_PATH, handler: claimInvite },
      ],
      after: [{ matcher: (ctx) => ctx.path === INVITE_MEMBER_PATH, handler: releaseFailedInvite }],
    },
  } satisfies BetterAuthPlugin;
}
