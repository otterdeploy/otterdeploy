/**
 * Revoke the CLI's session on the control plane: `otd logout`.
 *
 * The device login stores a better-auth session token, sent as a bearer on
 * every call. Deleting the local config alone left that token valid on the
 * server until it expired, so a copy of it (an old ~/.config backup, a CI log)
 * kept working after the user "logged out". better-auth's `/sign-out` deletes
 * the session the bearer names.
 */
import { Result } from "better-result";

import { fetchFor } from "./local-tls";

export type RevokeOutcome =
  /** The server deleted the session. */
  | { kind: "revoked" }
  /** The server no longer knew the session (already expired or revoked). */
  | { kind: "already-invalid" }
  /** The server could not be reached, or did not answer usefully. */
  | { kind: "unreachable"; reason: string };

const REVOKE_TIMEOUT_MS = 5_000;

export async function revokeSession(url: string, token: string): Promise<RevokeOutcome> {
  const answered = await Result.tryPromise({
    try: async () =>
      fetchFor(url)(`${url.replace(/\/$/, "")}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
          // better-auth checks a state-changing call's origin against its
          // trusted origins; the control plane itself is always one.
          origin: new URL(url).origin,
        },
        body: "{}",
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      }),
    catch: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  });
  if (answered.isErr()) return { kind: "unreachable", reason: answered.error };
  const response = answered.value;
  if (response.ok) return { kind: "revoked" };
  // No session behind the token: nothing left to revoke.
  if (response.status === 401 || response.status === 400) return { kind: "already-invalid" };
  return { kind: "unreachable", reason: `HTTP ${response.status}` };
}
