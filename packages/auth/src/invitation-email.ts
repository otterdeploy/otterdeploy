/**
 * The organization plugin's `sendInvitationEmail`: the invitation email, and a
 * record of whether it went out.
 *
 * A failed send used to be swallowed. The SDK default of zero retries lost
 * the email on a single 429, inviteMember answered 200, and the members page
 * showed the invitation exactly like a delivered one; only the server log
 * said otherwise. Now sendEmail retries transient provider errors (honouring
 * Retry-After) under one idempotency key, and the outcome is written to the
 * invitation (`email_status`, `email_error`), which both the inviteMember
 * response and list-invitations carry.
 */
import { db } from "@otterdeploy/db";
import { invitation } from "@otterdeploy/db/schema/auth";
import { OrganizationInvitationEmail, sendEmail } from "@otterdeploy/email";
import { toTemporalInstant } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { sql } from "drizzle-orm";
import { log } from "evlog";

import { resolveCanonicalWebOrigin } from "./web-origin";

/** What better-auth hands the hook, as far as this module reads it. */
export interface InvitationEmailInput {
  email: string;
  role: string;
  organization: { name: string };
  inviter: { user: { name: string } };
  invitation: { id: string; expiresAt: Date };
}

/** The provider's reason for a failed send, for the invitation row: sendEmail
 *  throws an evlog error whose `why` carries it ("Resend failed with 429: ..."). */
function emailFailureReason(cause: unknown): string {
  if (cause instanceof Error && "why" in cause && typeof cause.why === "string") return cause.why;
  return cause instanceof Error ? cause.message : String(cause);
}

export async function sendInvitationEmail(data: InvitationEmailInput): Promise<void> {
  // Build the accept link against the CANONICAL web origin (where
  // /accept-invite renders): the verified control-plane FQDN when the
  // operator has set one, else the env web origin. On a default
  // self-hosted install CORS_ORIGIN/BETTER_AUTH_URL hold the raw public
  // IP: the FQDN keeps that IP out of invite emails. Never throws
  // (falls back to env), so a settings hiccup can't fail inviteMember.
  const webOrigin = await resolveCanonicalWebOrigin();
  const inviteUrl = `${webOrigin}/accept-invite/${data.invitation.id}`;
  // Non-fatal by design: the invitation row is already persisted before
  // this runs, so a failed email send (e.g. missing/placeholder
  // RESEND_API_KEY in dev) must NOT fail inviteMember. But it must not
  // be silent either: sendEmail retries transient provider errors
  // (429/5xx, honouring Retry-After), and the outcome is recorded on
  // the invitation, so the invite response and the members page say
  // "email failed" instead of looking delivered. The accept link is
  // logged for out-of-band delivery.
  const sent = await Result.tryPromise({
    try: () =>
      sendEmail({
        to: data.email,
        subject: `Join ${data.organization.name} on otterdeploy`,
        react: OrganizationInvitationEmail({
          organizationName: data.organization.name,
          inviterName: data.inviter.user.name,
          inviteUrl,
          role: String(data.role ?? "member"),
        }),
        // One key per invitation and expiry: a retry of this send is
        // deduplicated by Resend, a deliberate re-send is not.
        idempotencyKey: `invitation/${data.invitation.id}/${toTemporalInstant.call(data.invitation.expiresAt).epochMilliseconds}`,
      }),
    catch: (cause) => emailFailureReason(cause),
  });
  const outcome = sent.isOk()
    ? { emailStatus: "sent", emailError: null }
    : { emailStatus: "failed", emailError: sent.error };
  await db
    .update(invitation)
    .set(outcome)
    // Raw comparison: better-auth mints invitation ids as
    // `invitation_<cuid>` (generateId falls back to the model name),
    // which idSchema.invitation (`inv_`) rejects.
    .where(sql`${invitation.id} = ${data.invitation.id}`);
  // better-auth answers inviteMember with this same object, so the
  // caller sees the outcome without a second read.
  Object.assign(data.invitation, outcome);
  if (sent.isErr()) {
    log.warn({
      invite: {
        status: "email-failed",
        email: data.email,
        // Logged so the operator can deliver the link out-of-band when
        // email isn't configured (e.g. placeholder RESEND_API_KEY in dev).
        inviteUrl,
        detail: sent.error,
      },
    });
  }
}
