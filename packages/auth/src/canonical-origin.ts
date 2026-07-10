/**
 * Canonical web origin for links the platform sends OUT of the app (invite
 * emails, copyable accept links, any future auth email). Prefers the
 * operator's VERIFIED control-plane FQDN over the env-configured base: on a
 * default self-hosted install BETTER_AUTH_URL / CORS_ORIGIN hold the raw
 * public IP the installer detected, and links built from them leak that IP
 * into emails. Server-side twin of the client precedent in
 * `connect-cli-dialog.tsx` (orpc.organization.controlPlaneDomain).
 *
 * Pure on purpose — no env/db imports — so it unit-tests without booting the
 * env schema or a database. The DB-backed resolver lives in `web-origin.ts`.
 */

/** The two platform_settings columns the decision needs (see
 *  packages/db/src/schema/platform.ts). */
export interface ControlPlaneDomainSettings {
  controlPlaneFqdn: string | null;
  controlPlaneFqdnVerifiedAt: Date | null;
}

/**
 * Resolve the canonical origin (no trailing slash):
 * - verified control-plane domain → `https://<domain>` — verification implies
 *   the edge serves it with a real ACME cert, so https is always right;
 * - unverified or absent domain → the env fallback verbatim (scheme included),
 *   since an unverified FQDN may not even resolve to this box yet.
 */
export function canonicalWebOrigin(
  settings: ControlPlaneDomainSettings | null | undefined,
  fallbackBase: string,
): string {
  if (settings?.controlPlaneFqdn && settings.controlPlaneFqdnVerifiedAt != null) {
    return `https://${settings.controlPlaneFqdn}`;
  }
  return fallbackBase.replace(/\/+$/, "");
}
