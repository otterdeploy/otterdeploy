/**
 * When a GitLab sign-in may claim an existing otterdeploy account.
 *
 * better-auth links a social sign-in to the existing user with the same email
 * when the provider is in `accountLinking.trustedProviders` OR the profile says
 * the email is verified. `gitlab` used to be trusted outright, and that is an
 * account takeover:
 *
 *   - the issuer is operator-set (a self-managed GitLab), and on a
 *     self-managed instance email confirmation can be off, or an admin can
 *     give any user any email;
 *   - GitLab's `/api/v4/user` (what better-auth reads) has no
 *     `email_verified` (an OIDC-only claim), so better-auth itself marks every
 *     GitLab user unverified; trust was the only thing letting linking happen.
 *
 * So whoever controlled the configured GitLab could sign in as any
 * otterdeploy user by setting that user's email on a GitLab account.
 *
 * Now GitLab is never trusted by name, and the profile's email counts as
 * verified only when it comes from gitlab.com (which requires a confirmed
 * primary email) AND the profile carries `confirmed_at`. A self-managed
 * GitLab can still sign users in and create accounts; it just cannot attach
 * itself to an existing account by email (better-auth answers
 * `account_not_linked`). A user who wants that link signs in with their
 * otterdeploy account and links GitLab from there.
 */

import { Result } from "better-result";

/** The only GitLab whose email confirmation the product relies on. */
export const GITLAB_COM_ORIGIN = "https://gitlab.com";

/** Providers whose email claim is trusted for implicit linking by name. */
export const TRUSTED_LINKING_PROVIDERS = ["github", "google"] as const;

/** True when the configured issuer is gitlab.com. better-auth's GitLab
 *  provider uses gitlab.com when no issuer is set. */
export function isGitlabComIssuer(issuer: string | undefined): boolean {
  if (issuer === undefined || issuer.trim() === "") return true;
  const origin = Result.try(() => new URL(issuer).origin);
  return origin.isOk() && origin.value === GITLAB_COM_ORIGIN;
}

/** Whether a GitLab `/api/v4/user` profile's email may be treated as verified. */
export function gitlabEmailVerified(
  issuer: string | undefined,
  profile: { confirmed_at?: unknown },
): boolean {
  return (
    isGitlabComIssuer(issuer) &&
    typeof profile.confirmed_at === "string" &&
    profile.confirmed_at.length > 0
  );
}

interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
  issuer?: string;
}

/** better-auth's GitLab options with the email-verification rule applied. */
export function createGitlabProviderOptions(credentials: ProviderCredentials) {
  return {
    ...credentials,
    mapProfileToUser: (profile: { confirmed_at?: unknown }) => ({
      emailVerified: gitlabEmailVerified(credentials.issuer, profile),
    }),
  };
}
