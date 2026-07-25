import { timingSafeEqual } from "node:crypto";

export const BOOTSTRAP_TOKEN_HEADER = "x-otterdeploy-bootstrap-token";

export type RegistrationDecision =
  | { allowed: true; installAdmin: boolean }
  | {
      allowed: false;
      reason: "bootstrap-token-missing" | "bootstrap-token-invalid" | "invite-required";
    };

function equalToken(presented: string, expected: string): boolean {
  const actualBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/**
 * Pure admission policy shared by the Better Auth hook and its hostile-path
 * tests. The initial account is email/password-only because an OAuth callback
 * cannot safely carry the one-time bootstrap credential across the provider.
 */
export function decideRegistration(input: {
  bootstrapComplete: boolean;
  hasPendingInvitation: boolean;
  authPath: string | undefined;
  configuredBootstrapToken: string | undefined;
  presentedBootstrapToken: string | undefined;
}): RegistrationDecision {
  if (input.bootstrapComplete) {
    return input.hasPendingInvitation
      ? { allowed: true, installAdmin: false }
      : { allowed: false, reason: "invite-required" };
  }

  const expected = input.configuredBootstrapToken;
  const presented = input.presentedBootstrapToken;
  if (!expected || !presented || input.authPath !== "/sign-up/email") {
    return { allowed: false, reason: "bootstrap-token-missing" };
  }
  if (!equalToken(presented, expected)) {
    return { allowed: false, reason: "bootstrap-token-invalid" };
  }
  return { allowed: true, installAdmin: true };
}
