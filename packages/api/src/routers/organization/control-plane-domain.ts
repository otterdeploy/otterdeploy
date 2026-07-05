/**
 * Control-plane domain settings (platform-wide singleton). The domain the
 * otterdeploy dashboard/API itself answers on — distinct from the org base
 * domain, which is where *deployed resources* publish. Surfaced under org
 * settings for the single-tenant beta (same precedent as email-settings).
 *
 * Model mirrors the org base domain: saving rotates a TXT verify token and
 * immediately reconciles the edge (the site goes live on `tls internal`);
 * TXT verification flips it to real ACME issuance. Cloudflare auto-configure
 * reuses the org's stored token/zone to write the TXT + A records.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { Result, TaggedError } from "better-result";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { reconcile } from "../../caddy";
import { upsertCloudflareDnsRecord } from "../../lib/cloudflare";
import { VERIFY_TXT_PREFIX, verifyDomainTxt, type VerifyOutcome } from "../../lib/dns-verify";
import { getOrganizationById } from "./queries";

export interface ControlPlaneDomainView {
  domain: string | null;
  verifiedAt: Date | null;
  verifyToken: string | null;
  /** Where the A record should point — surfaced so the UI can render the
   *  exact record to create. Null until boot detection / operator input. */
  serverIp: string | null;
}

type PlatformRow = typeof platformSettings.$inferSelect;

function toView(row: PlatformRow | undefined): ControlPlaneDomainView {
  return {
    domain: row?.controlPlaneFqdn ?? null,
    verifiedAt: row?.controlPlaneFqdnVerifiedAt ?? null,
    verifyToken: row?.controlPlaneFqdnVerifyToken ?? null,
    serverIp: row?.serverIp ?? null,
  };
}

async function readRow(): Promise<PlatformRow | undefined> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return row;
}

export class ControlPlaneDomainError extends TaggedError("ControlPlaneDomainError")<{
  reason: "domain" | "cloudflare" | "server-ip" | "api";
  message: string;
}>() {
  constructor(reason: "domain" | "cloudflare" | "server-ip" | "api", message: string) {
    super({ reason, message });
  }
}

export async function getControlPlaneDomain(): Promise<ControlPlaneDomainView> {
  return toView(await readRow());
}

/** Set (or clear, via empty string) the control-plane domain. A NEW value
 *  resets verification and rotates the token; a no-op save keeps a verified
 *  domain verified. Reconciles the edge either way the value changed. */
export async function setControlPlaneDomain(
  domain: string,
  rlog?: RequestLogger,
): Promise<ControlPlaneDomainView> {
  const trimmed = domain.trim().toLowerCase();
  const isClear = trimmed.length === 0;
  const existing = await readRow();
  const unchanged =
    !isClear &&
    existing?.controlPlaneFqdn != null &&
    existing.controlPlaneFqdn.toLowerCase() === trimmed;
  if (unchanged) return toView(existing);

  const set = {
    controlPlaneFqdn: isClear ? null : trimmed,
    controlPlaneFqdnVerifiedAt: null,
    controlPlaneFqdnVerifyToken: isClear ? null : randomBytes(16).toString("hex"),
  };
  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...set })
    .onConflictDoUpdate({ target: platformSettings.id, set });

  // Take effect immediately: the site block appears (or disappears) on the
  // live edge without waiting for verification — cert is internal until then.
  await reconcile(rlog);
  return getControlPlaneDomain();
}

export interface VerifyControlPlaneDomainResponse extends VerifyOutcome {
  settings: ControlPlaneDomainView;
}

export async function verifyControlPlaneDomain(
  rlog?: RequestLogger,
): Promise<VerifyControlPlaneDomainResponse> {
  const row = await readRow();
  if (!row?.controlPlaneFqdn) {
    return {
      ok: false,
      recordName: "",
      expected: "",
      found: [],
      reason: "missing-token",
      settings: toView(row),
    };
  }

  const outcome = await verifyDomainTxt({
    domain: row.controlPlaneFqdn,
    expectedToken: row.controlPlaneFqdnVerifyToken,
  });
  if (!outcome.ok) {
    return { ...outcome, settings: toView(row) };
  }

  await db
    .update(platformSettings)
    .set({ controlPlaneFqdnVerifiedAt: new Date() })
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
  // Verified ⇒ the site block flips from tls internal to ACME issuance.
  await reconcile(rlog);
  return { ...outcome, settings: await getControlPlaneDomain() };
}

export interface AutoConfigureControlPlaneResult {
  ok: boolean;
  txtRecordId: string | null;
  aRecordId: string | null;
  verify: { ok: boolean; reason: VerifyOutcome["reason"] };
  settings: ControlPlaneDomainView;
}

/** Write the TXT (verify token) + A (fqdn → serverIp) records through the
 *  org's stored Cloudflare token/zone, then verify + reconcile. Same flow as
 *  the org base domain's auto-configure, pointed at the platform row. */
export async function autoConfigureControlPlaneDomain(
  orgId: OrganizationId,
  rlog?: RequestLogger,
): Promise<Result<AutoConfigureControlPlaneResult, ControlPlaneDomainError>> {
  const [org, row] = await Promise.all([getOrganizationById(orgId), readRow()]);
  if (!row?.controlPlaneFqdn || !row.controlPlaneFqdnVerifyToken) {
    return Result.err(
      new ControlPlaneDomainError(
        "domain",
        "Save a control-plane domain first — there's nothing to point Cloudflare at.",
      ),
    );
  }
  if (!org?.cloudflareApiToken || !org.cloudflareZoneId) {
    return Result.err(
      new ControlPlaneDomainError(
        "cloudflare",
        "Connect Cloudflare in this workspace before auto-configuring DNS.",
      ),
    );
  }
  if (!row.serverIp) {
    return Result.err(
      new ControlPlaneDomainError(
        "server-ip",
        "Platform serverIp not configured — set it before auto-configuring DNS.",
      ),
    );
  }

  // Capture narrowed values — the guards above don't carry into the closure.
  const domain = row.controlPlaneFqdn;
  const verifyToken = row.controlPlaneFqdnVerifyToken;
  const serverIp = row.serverIp;
  const cfToken = org.cloudflareApiToken;
  const cfZone = org.cloudflareZoneId;
  const records = await Result.tryPromise({
    try: async () => {
      const txt = await upsertCloudflareDnsRecord({
        token: cfToken,
        zoneId: cfZone,
        type: "TXT",
        name: `${VERIFY_TXT_PREFIX}.${domain}`,
        content: verifyToken,
      });
      const a = await upsertCloudflareDnsRecord({
        token: cfToken,
        zoneId: cfZone,
        type: "A",
        name: domain,
        content: serverIp,
      });
      return { txt, a };
    },
    catch: (err) =>
      new ControlPlaneDomainError("api", err instanceof Error ? err.message : String(err)),
  });
  if (records.isErr()) return Result.err(records.error);

  // Cloudflare DNS typically propagates within ~10s; verify immediately and
  // let the operator retry from the card if the resolver hasn't caught up.
  const verified = await verifyControlPlaneDomain(rlog);
  return Result.ok({
    ok: verified.ok,
    txtRecordId: records.value.txt.id,
    aRecordId: records.value.a.id,
    verify: { ok: verified.ok, reason: verified.reason },
    settings: verified.settings,
  });
}
