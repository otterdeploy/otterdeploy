import { ORPCError } from "@orpc/server";

export const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

function extractStepUpTimestamp(session: unknown): Date | null {
  const candidates = [
    (session as { session?: { metadata?: { lastTwoFactorVerifiedAt?: string } } })?.session
      ?.metadata?.lastTwoFactorVerifiedAt,
    (session as { session?: { lastTwoFactorVerifiedAt?: string } })?.session
      ?.lastTwoFactorVerifiedAt,
    (session as { metadata?: { lastTwoFactorVerifiedAt?: string } })?.metadata
      ?.lastTwoFactorVerifiedAt,
    (session as { lastTwoFactorVerifiedAt?: string })?.lastTwoFactorVerifiedAt,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

export function assertFreshStepUp(session: unknown) {
  const verifiedAt = extractStepUpTimestamp(session);
  if (!verifiedAt) {
    throw new ORPCError("FORBIDDEN", {
      message: "Step-up verification required",
    });
  }

  if (Date.now() - verifiedAt.getTime() > STEP_UP_WINDOW_MS) {
    throw new ORPCError("FORBIDDEN", {
      message: "Step-up verification expired. Re-verify 2FA and retry.",
    });
  }
}
