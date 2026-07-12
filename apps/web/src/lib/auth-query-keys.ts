/**
 * React-query keys for better-auth-backed queries (session, sessions, org
 * invitations, device-code claim). better-auth is not an oRPC procedure, so
 * `orpc.<path>.queryKey()` can't generate these — centralizing the literals
 * here is the single-source-of-truth equivalent: call sites import a key
 * instead of re-typing `["auth", …]`, so a rename can't silently miss one.
 */

export const authQueryKeys = {
  /** Broad prefix — invalidating this refetches every auth-scoped query. */
  all: ["auth"] as const,
  /** The current better-auth session. */
  currentSession: ["auth", "current-session"] as const,
  /** The user's active sessions list. */
  sessions: ["auth", "sessions"] as const,
  /** A pending org invitation, by id. */
  invitation: (invitationId: string) => ["invitation", invitationId] as const,
  /** A device-authorization claim, by user code. */
  deviceClaim: (userCode: string) => ["device", "claim", userCode] as const,
};
