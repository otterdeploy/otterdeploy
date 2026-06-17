/**
 * Org-settings handlers. Compose against the contract — same input/output
 * shapes, plus the org-scope guard that asserts the caller is acting on
 * the org they're authenticated to.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { Result, TaggedError } from "better-result";

import {
  CloudflareError,
  listCloudflareZones,
  upsertCloudflareDnsRecord,
  verifyCloudflareToken,
  type CloudflareZone,
} from "../../lib/cloudflare";
import {
  VERIFY_TXT_PREFIX,
  verifyDomainTxt,
  type VerifyOutcome,
} from "../../lib/dns-verify";

import {
  eq,
} from "drizzle-orm";
import { db } from "@otterdeploy/db";
import {
  PLATFORM_SETTINGS_ID,
  platformSettings,
} from "@otterdeploy/db/schema/platform";
import { hasEnvTransport, invalidateTransport, sendEmail } from "@otterdeploy/email";

import { encryptSecret } from "../../lib/crypto";

import {
  getOrganizationById,
  markOrganizationBaseDomainVerified,
  setOrganizationBaseDomain,
  setOrganizationCloudflareConfig,
} from "./queries";

type OrgId = OrganizationId;

interface OrgSettingsView {
  id: OrgId;
  name: string;
  slug: string;
  baseDomain: string | null;
  baseDomainVerifiedAt: Date | null;
  baseDomainVerifyToken: string | null;
  cloudflareZoneId: string | null;
  cloudflareTokenConfigured: boolean;
}

function toView(row: NonNullable<Awaited<ReturnType<typeof getOrganizationById>>>): OrgSettingsView {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    baseDomain: row.baseDomain,
    baseDomainVerifiedAt: row.baseDomainVerifiedAt,
    baseDomainVerifyToken: row.baseDomainVerifyToken,
    cloudflareZoneId: row.cloudflareZoneId,
    // Never leak the token itself. Just signal presence so the UI can
    // render "Connected" vs "Add token" without exposing the secret.
    cloudflareTokenConfigured:
      row.cloudflareApiToken != null && row.cloudflareApiToken.length > 0,
  };
}

class OrganizationNotFoundError extends TaggedError("OrganizationNotFoundError")<{
  organizationId: OrgId;
  message: string;
}>() {
  constructor(organizationId: OrgId) {
    super({ organizationId, message: `organization ${organizationId} not found` });
  }
}

export async function getOrganizationSettings(
  orgId: OrgId,
): Promise<Result<OrgSettingsView, OrganizationNotFoundError>> {
  const row = await getOrganizationById(orgId);
  if (!row) return Result.err(new OrganizationNotFoundError(orgId));
  return Result.ok(toView(row));
}

export async function updateOrganizationBaseDomain(input: {
  organizationId: OrgId;
  baseDomain: string;
}): Promise<Result<OrgSettingsView, OrganizationNotFoundError>> {
  const row = await setOrganizationBaseDomain(
    input.organizationId,
    input.baseDomain,
  );
  if (!row) return Result.err(new OrganizationNotFoundError(input.organizationId));
  return Result.ok(toView(row));
}

export interface VerifyDomainResponse extends VerifyOutcome {
  settings: OrgSettingsView | null;
}

class CloudflareConfigError extends TaggedError("CloudflareConfigError")<{
  reason: "token" | "zone" | "domain" | "api";
  message: string;
}>() {
  constructor(reason: "token" | "zone" | "domain" | "api", message: string) {
    super({ reason, message });
  }
}

export async function listZonesForToken(
  token: string,
): Promise<Result<CloudflareZone[], CloudflareConfigError>> {
  // Validate the token's scope before listing — fast-fails with a clear
  // error instead of "0 zones returned" if the operator pasted something
  // wrong (expired, wrong account, wrong scope).
  const verify = await verifyCloudflareToken(token);
  if (!verify.ok) {
    return Result.err(
      new CloudflareConfigError("token", `Cloudflare rejected token: ${verify.status}`),
    );
  }
  try {
    const zones = await listCloudflareZones(token);
    return Result.ok(zones);
  } catch (err) {
    return Result.err(
      new CloudflareConfigError(
        "api",
        err instanceof Error ? err.message : String(err),
      ),
    );
  }
}

export async function saveOrganizationCloudflareConfig(input: {
  organizationId: OrgId;
  token: string;
  zoneId: string | null;
}): Promise<
  Result<OrgSettingsView, OrganizationNotFoundError | CloudflareConfigError>
> {
  const isClear = input.token.trim().length === 0;
  if (!isClear) {
    // Re-validate the token at save time — UI flows may have selected a
    // zone from a list rendered minutes ago, and the token could have
    // been rotated since. Cheap (one HTTP call), prevents storing
    // already-dead credentials.
    const verify = await verifyCloudflareToken(input.token);
    if (!verify.ok) {
      return Result.err(
        new CloudflareConfigError("token", `Token rejected: ${verify.status}`),
      );
    }
    if (!input.zoneId) {
      return Result.err(
        new CloudflareConfigError("zone", "Pick a Cloudflare zone before saving."),
      );
    }
  }
  const row = await setOrganizationCloudflareConfig({
    orgId: input.organizationId,
    apiToken: isClear ? null : input.token,
    zoneId: isClear ? null : input.zoneId,
  });
  if (!row) {
    return Result.err(new OrganizationNotFoundError(input.organizationId));
  }
  return Result.ok(toView(row));
}

export async function autoConfigureBaseDomainViaCloudflare(
  orgId: OrgId,
): Promise<
  Result<
    {
      ok: boolean;
      txtRecordId: string | null;
      aRecordId: string | null;
      verify: { ok: boolean; reason: VerifyOutcome["reason"] };
      settings: OrgSettingsView;
    },
    OrganizationNotFoundError | CloudflareConfigError
  >
> {
  const row = await getOrganizationById(orgId);
  if (!row) return Result.err(new OrganizationNotFoundError(orgId));
  if (!row.baseDomain || !row.baseDomainVerifyToken) {
    return Result.err(
      new CloudflareConfigError(
        "domain",
        "Save a base domain on this org first — there's nothing for us to point Cloudflare at.",
      ),
    );
  }
  if (!row.cloudflareApiToken || !row.cloudflareZoneId) {
    return Result.err(
      new CloudflareConfigError(
        "token",
        "Connect Cloudflare to this org before auto-configuring DNS.",
      ),
    );
  }

  // Look up the platform's serverIp so the A record points at the right
  // host. sslip fallback wouldn't help here — auto-configure is only
  // meaningful when the operator has a real IP to publish under their
  // own domain.
  const [settings] = await db
    .select({ serverIp: platformSettings.serverIp })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  if (!settings?.serverIp) {
    return Result.err(
      new CloudflareConfigError(
        "domain",
        "Platform serverIp not configured — set it in platform settings before auto-configuring DNS.",
      ),
    );
  }

  try {
    // TXT for verification + A for the apex itself. We don't create the
    // `apps.<domain>` / `db.<domain>` records here — those are wildcards
    // the operator can add manually for now (each resource lives at a
    // unique subdomain so we'd otherwise be creating one A record per
    // resource on every deploy, which gets noisy fast). A follow-up could
    // create a `*.apps` / `*.db` wildcard CNAME and call it done.
    const txt = await upsertCloudflareDnsRecord({
      token: row.cloudflareApiToken,
      zoneId: row.cloudflareZoneId,
      type: "TXT",
      name: `${VERIFY_TXT_PREFIX}.${row.baseDomain}`,
      content: row.baseDomainVerifyToken,
    });
    const a = await upsertCloudflareDnsRecord({
      token: row.cloudflareApiToken,
      zoneId: row.cloudflareZoneId,
      type: "A",
      name: row.baseDomain,
      content: settings.serverIp,
    });

    // Cloudflare-managed DNS typically propagates within ~10s. We
    // attempt verification immediately; if it fails (record not yet
    // visible from this node's resolver), the operator can hit Verify
    // again in a moment.
    const verifyResult = await verifyDomainTxt({
      domain: row.baseDomain,
      expectedToken: row.baseDomainVerifyToken,
    });
    let updated = row;
    if (verifyResult.ok) {
      const stamped = await markOrganizationBaseDomainVerified(orgId);
      if (stamped) updated = stamped;
    }

    return Result.ok({
      ok: verifyResult.ok,
      txtRecordId: txt.id,
      aRecordId: a.id,
      verify: { ok: verifyResult.ok, reason: verifyResult.reason },
      settings: toView(updated),
    });
  } catch (err) {
    if (err instanceof CloudflareError) {
      return Result.err(new CloudflareConfigError("api", err.message));
    }
    return Result.err(
      new CloudflareConfigError(
        "api",
        err instanceof Error ? err.message : String(err),
      ),
    );
  }
}

export async function verifyOrganizationBaseDomain(
  orgId: OrgId,
): Promise<Result<VerifyDomainResponse, OrganizationNotFoundError>> {
  const row = await getOrganizationById(orgId);
  if (!row) return Result.err(new OrganizationNotFoundError(orgId));

  if (!row.baseDomain) {
    return Result.ok({
      ok: false,
      recordName: "",
      expected: "",
      found: [],
      reason: "missing-token",
      settings: toView(row),
    });
  }

  const outcome = await verifyDomainTxt({
    domain: row.baseDomain,
    expectedToken: row.baseDomainVerifyToken,
  });

  if (!outcome.ok) {
    return Result.ok({ ...outcome, settings: toView(row) });
  }

  // Stamp verified — the next read of org.settings will show
  // baseDomainVerifiedAt, and the resolver / Caddy paths gate ACME on it.
  const updated = await markOrganizationBaseDomainVerified(orgId);
  return Result.ok({
    ...outcome,
    settings: updated ? toView(updated) : toView(row),
  });
}

// ─── Outbound email transport (platform-wide singleton) ─────────────
// Surfaced under org settings for the single-tenant beta; writes the one
// install-wide platform_settings row. Secrets are encrypted at rest and never
// returned — reads expose only `*Configured` booleans.

export interface EmailSettingsView {
  provider: "resend" | "smtp" | null;
  from: string | null;
  resendConfigured: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  smtpPasswordConfigured: boolean;
  /** RESEND_API_KEY is set in env, so "Platform default" actually sends. When
   *  false and no provider is configured, email is unconfigured (UI warns). */
  envConfigured: boolean;
}

type PlatformRow = typeof platformSettings.$inferSelect;

function toEmailView(row: PlatformRow | undefined): EmailSettingsView {
  return {
    provider: (row?.emailProvider as "resend" | "smtp" | null) ?? null,
    from: row?.emailFrom ?? null,
    resendConfigured: Boolean(row?.resendApiKeyCiphertext),
    smtpHost: row?.smtpHost ?? null,
    smtpPort: row?.smtpPort ?? null,
    smtpSecure: row?.smtpSecure ?? null,
    smtpUser: row?.smtpUser ?? null,
    smtpPasswordConfigured: Boolean(row?.smtpPasswordCiphertext),
    envConfigured: hasEnvTransport(),
  };
}

export async function getEmailSettings(): Promise<EmailSettingsView> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return toEmailView(row);
}

export interface SaveEmailSettingsInput {
  provider: "resend" | "smtp" | null;
  from: string | null;
  /** undefined ⇒ leave unchanged; null ⇒ clear; string ⇒ set (encrypted). */
  resendApiKey?: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  smtpPassword?: string | null;
}

export async function saveEmailSettings(
  input: SaveEmailSettingsInput,
): Promise<EmailSettingsView> {
  const set: Partial<typeof platformSettings.$inferInsert> = {
    emailProvider: input.provider,
    emailFrom: input.from,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure,
    smtpUser: input.smtpUser,
  };
  if (input.resendApiKey !== undefined) {
    set.resendApiKeyCiphertext = input.resendApiKey
      ? await encryptSecret(input.resendApiKey)
      : null;
  }
  if (input.smtpPassword !== undefined) {
    set.smtpPasswordCiphertext = input.smtpPassword
      ? await encryptSecret(input.smtpPassword)
      : null;
  }

  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...set })
    .onConflictDoUpdate({ target: platformSettings.id, set });

  // Drop the email package's cached transport so the next send re-reads.
  invalidateTransport();
  return getEmailSettings();
}

export async function sendTestEmail(
  to: string,
): Promise<{ ok: boolean; error: string | null }> {
  const res = await Result.tryPromise({
    // Return void — we only care that it didn't throw, and returning
    // sendEmail's cross-package union return trips no-unsafe-return.
    try: async () => {
      await sendEmail({
        to,
        subject: "otterdeploy — test email",
        html: "<p>This is a test email from otterdeploy. Your email transport is working.</p>",
        text: "This is a test email from otterdeploy. Your email transport is working.",
      });
    },
    catch: (cause) => cause,
  });
  return res.isOk()
    ? { ok: true, error: null }
    : {
        ok: false,
        error: res.error instanceof Error ? res.error.message : String(res.error),
      };
}
