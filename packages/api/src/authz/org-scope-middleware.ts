/**
 * The org-scoped gate every organization procedure passes through
 * (packages/api/src/index.ts builds `orgScopedProcedure` on it): an actor, an
 * active organization the actor still belongs to, and no disagreement with
 * the organization the request says it acts in.
 */
import { ORPCError, os as orpc } from "@orpc/server";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

import type { Context } from "../context";

import { ORGANIZATION_SWITCHED, statedOrganizationsOf } from "./acting-organization";
import { isOrgMember } from "./org-member";
import { guardStreamMembership, isAsyncIteratorObject } from "./stream-membership";

/** A real API key over its budget is a 429 with a retry hint, not a 401.
 *  Shared by both authenticating middlewares below. Keyed by
 *  oRPC's standard TOO_MANY_REQUESTS code: at runtime the error map is the
 *  contract procedure's, not this middleware's, so the status comes from the
 *  code's built-in default (429), the same way UNAUTHORIZED gets its 401. */
export const apiKeyRateLimitedError = {
  status: 429,
  message: "API key rate limit exceeded.",
  data: z.object({ retryAfterSeconds: z.number() }),
} as const;

const organizationIdSchema = zId(ID_PREFIX.organization);

/** A stated organization id in canonical form (legacy spellings folded), so
 *  it compares equal to the session's parsed id; anything unparsable stays as
 *  sent and so never matches. */
function canonicalOrganizationId(raw: string): string {
  const parsed = organizationIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : raw;
}

/**
 * Procedure that requires both authentication AND an active organization.
 * Handlers receive `context.activeOrganizationId` narrowed to `string`.
 *
 * The refusals here are thrown as ORPCErrors with an explicit status, not
 * through a middleware `.errors()` map: at runtime the error map is the
 * contract procedure's, so a custom code declared only here answered as an
 * untyped 500.
 */
export const orgScopedMiddleware = orpc
  .$context<Context>()
  .errors({
    UNAUTHORIZED: { message: "Unauthorized" },
    TOO_MANY_REQUESTS: apiKeyRateLimitedError,
    FORBIDDEN: {
      status: 403,
      message: "You are not a member of this organization.",
    },
  })
  .middleware(async ({ context, next, errors }, input: unknown) => {
    // Session/cookie/CLI-bearer user OR a verified API-key actor. For a key
    // actor `activeOrganizationId` was already populated from the key's owning
    // org in createContext, so the NO_ACTIVE_ORGANIZATION gate still holds.
    if (!context.actor) {
      if (context.apiKeyRateLimited) {
        throw errors.TOO_MANY_REQUESTS({
          message: context.apiKeyRateLimited.message,
          data: { retryAfterSeconds: context.apiKeyRateLimited.retryAfterSeconds },
        });
      }
      throw errors.UNAUTHORIZED();
    }
    if (!context.activeOrganizationId) {
      // A session with no workspace (its member was removed, or it never
      // picked one): a state the client can resolve by choosing one, so a
      // typed 409 it can act on, never a 500.
      throw new ORPCError("NO_ACTIVE_ORGANIZATION", {
        status: 409,
        message: "No active organization. Choose an organization before calling this endpoint.",
      });
    }
    // A session names its active organization, but only the member table says
    // the user still belongs to it: a member removed mid-session keeps a
    // session (and up to five minutes of cookie cache) that still names the
    // organization. One indexed lookup per org-scoped call. A key
    // actor's organization is the key's own, so it needs no such check.
    if (
      context.session &&
      !(await isOrgMember(context.session.user.id, context.activeOrganizationId))
    ) {
      throw errors.FORBIDDEN();
    }
    // The page (or the input) names the organization it acts in; when another
    // tab switched the session since, the request must not act in the session's
    // new organization behind the user's back. See
    // authz/acting-organization.ts.
    const activeOrganizationId = context.activeOrganizationId;
    const elsewhere = statedOrganizationsOf(context.headers, input).find(
      (stated) => canonicalOrganizationId(stated) !== activeOrganizationId,
    );
    if (elsewhere !== undefined) {
      throw new ORPCError(ORGANIZATION_SWITCHED, {
        status: 409,
        message:
          "This page belongs to a different organization than the one your session is now in (it was switched in another tab or window). Switch back to it, or reload, before trying again.",
        data: { statedOrganizationId: elsewhere, activeOrganizationId },
      });
    }
    const result = await next({
      context: {
        actor: context.actor,
        session: context.session,
        apiKey: context.apiKey,
        activeOrganizationId,
      },
    });
    // A stream outlives the check above: re-check membership while it runs,
    // so a member removed mid-stream stops receiving frames.
    if (context.session && isAsyncIteratorObject(result.output)) {
      return {
        ...result,
        output: guardStreamMembership(result.output, {
          userId: context.session.user.id,
          organizationId: activeOrganizationId,
        }),
      };
    }
    return result;
  });
