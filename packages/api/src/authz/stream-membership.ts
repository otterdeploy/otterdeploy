/**
 * Membership for the life of a stream, not just its first frame.
 *
 * The org-scoped guard checks the member table once per call. For a plain call
 * that is the whole call; for a streaming procedure (event streams, log tails,
 * over HTTP or a WebSocket) the call is open for as long as the tab
 * is, so a member removed after subscribing kept receiving the organization's
 * events and logs until they closed the page.
 *
 * `guardStreamMembership` wraps the stream the handler returned and re-checks
 * membership before a frame is handed over, at most once per `recheckMs` (a
 * busy log tail must not cost one query per line). Once the member table no
 * longer has the user, the stream ends with the same FORBIDDEN the next plain
 * call would get, and the inner iterator is finalized (its Redis subscription
 * or docker attachment released) exactly as a client abort would.
 */
import { mapEventIterator } from "@orpc/client";
import { ORPCError } from "@orpc/server";

import { isOrgMember } from "./org-member";

/** Longest a removed member can go on receiving frames. */
export const STREAM_MEMBERSHIP_RECHECK_MS = 5_000;

export const STREAM_MEMBERSHIP_REVOKED_MESSAGE = "You are not a member of this organization.";

export interface StreamMembershipOptions {
  userId: string;
  organizationId: string;
  recheckMs?: number;
  /** Seams for tests; production uses the member table and a monotonic clock. */
  isMember?: (userId: string, organizationId: string) => Promise<boolean>;
  now?: () => number;
}

/** True for what oRPC streams: an async iterator object. */
export function isAsyncIteratorObject(value: unknown): value is AsyncIteratorObject<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    "next" in value &&
    typeof value.next === "function"
  );
}

export function guardStreamMembership<T, R>(
  stream: AsyncIterator<T, R, unknown>,
  options: StreamMembershipOptions,
): AsyncIteratorObject<T | R, T | R, unknown> {
  const recheckMs = options.recheckMs ?? STREAM_MEMBERSHIP_RECHECK_MS;
  const isMember = options.isMember ?? isOrgMember;
  const now = options.now ?? (() => performance.now());
  // The guard that let the call in has just checked: the first window is free.
  let checkedAt = now();

  return mapEventIterator<T, R, unknown>(stream, {
    async value(value: T | R, done) {
      if (done || now() - checkedAt < recheckMs) return value;
      if (!(await isMember(options.userId, options.organizationId))) {
        throw new ORPCError("FORBIDDEN", {
          status: 403,
          message: STREAM_MEMBERSHIP_REVOKED_MESSAGE,
        });
      }
      checkedAt = now();
      return value;
    },
    error: async (error) => error,
  });
}
