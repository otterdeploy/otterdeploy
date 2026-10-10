/**
 * Org-settings handlers. Compose against the contract: same input/output
 * shapes, plus the org-scope guard that asserts the caller is acting on
 * the org they're authenticated to.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { Result, TaggedError } from "better-result";

import { writeBaseDomainRecords } from "../../lib/base-domain-dns";
import {
  listCloudflareZones,
  verifyCloudflareToken,
  type CloudflareZone,
} from "../../lib/cloudflare";
import { verifyDomainTxt, type VerifyOutcome } from "../../lib/dns-verify";
import { repairBaseDomainWildcard, type WildcardRepair } from "./base-domain";
import { OrganizationNotFoundError } from "./errors";
import {
  getOrganizationById,
  markOrganizationBaseDomainVerified,
  readPlatformServerIp,
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

function toView(
  row: NonNullable<Awaited<ReturnType<typeof getOrganizationById>>>,
): OrgSettingsView {
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
    cloudflareTokenConfigured: row.cloudflareApiToken != null && row.cloudflareApiToken.length > 0,
  };
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
  const row = await setOrganizationBaseDomain(input.organizationId, input.baseDomain);
  if (!row) return Result.err(new OrganizationNotFoundError(input.organizationId));
  await repairBaseDomainWildcard(row);
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
  // Validate the token's scope before listing. Fast-fails with a clear
  // error instead of "0 zones returned" if the operator pasted something
  // wrong (expired, wrong account, wrong scope).
  const verify = await verifyCloudflareToken(token);
  if (verify.isErr()) {
    return Result.err(
      new CloudflareConfigError("token", `Cloudflare rejected token: ${verify.error.message}`),
    );
  }
  if (!verify.value.active) {
    return Result.err(
      new CloudflareConfigError("token", `Cloudflare rejected token: ${verify.value.status}`),
    );
  }

  const zones = await listCloudflareZones(token);
  if (zones.isErr()) return Result.err(new CloudflareConfigError("api", zones.error.message));
  return Result.ok(zones.value);
}

export async function saveOrganizationCloudflareConfig(input: {
  organizationId: OrgId;
  token: string;
  zoneId: string | null;
}): Promise<Result<OrgSettingsView, OrganizationNotFoundError | CloudflareConfigError>> {
  const isClear = input.token.trim().length === 0;
  if (!isClear) {
    // Re-validate the token at save time. UI flows may have selected a
    // zone from a list rendered minutes ago, and the token could have
    // been rotated since. Cheap (one HTTP call), prevents storing
    // already-dead credentials.
    const verify = await verifyCloudflareToken(input.token);
    if (verify.isErr()) {
      return Result.err(
        new CloudflareConfigError("token", `Token rejected: ${verify.error.message}`),
      );
    }
    if (!verify.value.active) {
      return Result.err(
        new CloudflareConfigError("token", `Token rejected: ${verify.value.status}`),
      );
    }
    if (!input.zoneId) {
      return Result.err(new CloudflareConfigError("zone", "Pick a Cloudflare zone before saving."));
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

export async function autoConfigureBaseDomainViaCloudflare(orgId: OrgId): Promise<
  Result<
    {
      ok: boolean;
      txtRecordId: string | null;
      aRecordId: string | null;
      wildcardRecordId: string | null;
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
        "Save a base domain on this org first. There's nothing for us to point Cloudflare at.",
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

  // The A records point at the platform's serverIp. The sslip fallback would
  // not help here: auto-configure only means something when there is a real
  // IP to publish under the operator's own domain.
  const serverIp = await readPlatformServerIp();
  if (!serverIp) {
    return Result.err(
      new CloudflareConfigError(
        "domain",
        "Platform serverIp not configured: set it in platform settings before auto-configuring DNS.",
      ),
    );
  }

  // TXT for verification, A for the apex, and the wildcard every service
  // hostname (`<service>-<project>.<base>`) resolves through.
  const written = await writeBaseDomainRecords({
    token: row.cloudflareApiToken,
    zoneId: row.cloudflareZoneId,
    baseDomain: row.baseDomain,
    serverIp,
    verifyToken: row.baseDomainVerifyToken,
  });
  if (written.isErr()) return Result.err(new CloudflareConfigError("api", written.error.message));

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
    txtRecordId: written.value.txtRecordId,
    aRecordId: written.value.aRecordId,
    wildcardRecordId: written.value.wildcardRecordId,
    verify: { ok: verifyResult.ok, reason: verifyResult.reason },
    settings: toView(updated),
  });
}

export async function verifyOrganizationBaseDomain(
  orgId: OrgId,
): Promise<Result<VerifyDomainResponse & { wildcard: WildcardRepair }, OrganizationNotFoundError>> {
  const row = await getOrganizationById(orgId);
  if (!row) return Result.err(new OrganizationNotFoundError(orgId));
  const wildcard = await repairBaseDomainWildcard(row);

  if (!row.baseDomain) {
    return Result.ok({
      ok: false,
      recordName: "",
      expected: "",
      found: [],
      reason: "missing-token",
      settings: toView(row),
      wildcard,
    });
  }

  const outcome = await verifyDomainTxt({
    domain: row.baseDomain,
    expectedToken: row.baseDomainVerifyToken,
  });

  if (!outcome.ok) {
    return Result.ok({ ...outcome, settings: toView(row), wildcard });
  }

  // Stamp verified: the next read of org.settings will show
  // baseDomainVerifiedAt, and the resolver / Caddy paths gate ACME on it.
  const updated = await markOrganizationBaseDomainVerified(orgId);
  return Result.ok({
    ...outcome,
    settings: updated ? toView(updated) : toView(row),
    wildcard,
  });
}
