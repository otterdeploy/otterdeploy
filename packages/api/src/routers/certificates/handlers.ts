/**
 * Certificates business logic.
 *
 * Inventory = live TLS probes of every enabled public domain in the org (the
 * exact probe the per-project Networking tab uses) — ground truth, never
 * cached. Custom certs are validated with node:crypto (chain parses, key
 * pairs with the leaf, hostname covered), the key is AES-GCM-encrypted at
 * rest (same helper as registry passwords / SSH private keys), and
 * installation goes through the SAME reconcile pass every route change uses:
 * files are materialized under the edge's /etc/caddy mount and `tls`
 * directives emitted per matching route. The reported `applied` /
 * `installState` is the real outcome of that pass — a cert that couldn't be
 * written or that the edge rejected says so, it is never shown as live.
 */
import type {
  CustomCertificateId,
  OrganizationId,
  ProjectId,
  TrustedCaId,
  UserId,
} from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { Result, panic } from "better-result";
import { eq } from "drizzle-orm";

import type { OrgRef } from "../scopes";
import type { CustomCertificateWithUploader, OrgDomainRow, TrustedCaRecord } from "./queries";

import { reconcile } from "../../caddy";
import { removeCustomCertFiles } from "../../caddy/certs";
import { type CertProbe, probeCertificate } from "../../lib/cert-probe";
import { encryptSecret } from "../../lib/crypto";
import {
  certCoversDomain,
  checkKeyMatchesCertificate,
  parseCertificateChain,
  type ParsedCertificate,
} from "../../lib/x509";
import { isUniqueViolation } from "../project/views";
import {
  CertificateConflictError,
  CertificateInvalidError,
  CertificateNotFoundError,
  TrustedCaConflictError,
  TrustedCaInvalidError,
  TrustedCaNotFoundError,
} from "./errors";
import {
  deleteCustomCertRecord,
  deleteTrustedCaRecord,
  getCustomCertInOrg,
  insertCustomCert,
  insertTrustedCa,
  listCustomCertsByOrg,
  listOrgEnabledHttpDomains,
  listTrustedCasByOrg,
  replaceCustomCertMaterial,
  setCustomCertInstallOutcome,
} from "./queries";

// ─── inventory ──────────────────────────────────────────────────────

export interface InventoryProject {
  id: ProjectId;
  name: string;
  slug: string;
}

export interface InventoryCertificate extends CertProbe {
  projects: InventoryProject[];
  customCertificateId: CustomCertificateId | null;
}

export interface OrgCertificateInventory {
  edgeHost: string;
  probedAt: string;
  certificates: InventoryCertificate[];
}

/** The platform's configured public edge address; loopback in dev / before
 *  detection (same fallback as the per-project probe). */
async function readEdgeHost(): Promise<string> {
  const [row] = await db
    .select({ serverIp: platformSettings.serverIp })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return row?.serverIp ?? "127.0.0.1";
}

function groupDomains(rows: OrgDomainRow[]): Map<string, InventoryProject[]> {
  const byDomain = new Map<string, Map<string, InventoryProject>>();
  for (const r of rows) {
    const projects = byDomain.get(r.domain) ?? new Map<string, InventoryProject>();
    projects.set(r.projectId, {
      id: r.projectId as ProjectId,
      name: r.projectName,
      slug: r.projectSlug,
    });
    byDomain.set(r.domain, projects);
  }
  return new Map([...byDomain].map(([domain, projects]) => [domain, [...projects.values()]]));
}

/** Probe every enabled public domain across the org's projects and tag any
 *  domain whose SERVED leaf matches a stored custom cert (fingerprint). */
export async function listOrgCertificates(input: OrgRef): Promise<OrgCertificateInventory> {
  const [rows, customCerts, edgeHost] = await Promise.all([
    listOrgEnabledHttpDomains(input.organizationId),
    listCustomCertsByOrg(input.organizationId),
    readEdgeHost(),
  ]);
  const byDomain = groupDomains(rows);
  const byFingerprint = new Map(customCerts.map((c) => [c.fingerprint256, c.id]));

  const domains = [...byDomain.keys()];
  const probes = await Promise.all(
    domains.map((domain) => probeCertificate({ domain, host: edgeHost })),
  );

  return {
    edgeHost,
    probedAt: new Date().toISOString(),
    certificates: probes.map((probe) => ({
      ...probe,
      projects: byDomain.get(probe.domain) ?? [],
      customCertificateId: probe.fingerprint
        ? (byFingerprint.get(probe.fingerprint) ?? null)
        : null,
    })),
  };
}

// ─── custom certificates ────────────────────────────────────────────

export type CustomCertView = CustomCertificateWithUploader & { matchingDomains: string[] };

function matchingDomainsFor(
  cert: Pick<CustomCertificateWithUploader, "hostname" | "subject" | "sans">,
  domains: string[],
): string[] {
  const subjectCN = cert.subject?.match(/(?:^|, )CN=([^,]+)/)?.[1] ?? null;
  return domains.filter(
    (d) =>
      d.toLowerCase() === cert.hostname.toLowerCase() ||
      certCoversDomain({ subjectCN, sans: cert.sans }, d),
  );
}

export async function listCustomCertificates(input: OrgRef): Promise<CustomCertView[]> {
  const [certs, domainRows] = await Promise.all([
    listCustomCertsByOrg(input.organizationId),
    listOrgEnabledHttpDomains(input.organizationId),
  ]);
  const domains = [...new Set(domainRows.map((r) => r.domain))];
  return certs.map((c) => ({ ...c, matchingDomains: matchingDomainsFor(c, domains) }));
}

interface ValidatedUpload {
  leaf: ParsedCertificate;
  hostname: string;
}

/** Shared upload/replace validation: chain parses, it isn't a bare CA, the
 *  key pairs with the leaf, and the hostname (given or derived) is covered. */
function validateCustomCertMaterial(input: {
  hostname?: string;
  certPem: string;
  keyPem: string;
  /** When replacing, the hostname is fixed by the existing row. */
  fixedHostname?: string;
}): Result<ValidatedUpload, CertificateInvalidError> {
  const parsed = parseCertificateChain(input.certPem);
  if (!parsed.ok) return Result.err(new CertificateInvalidError({ message: parsed.error }));
  const { leaf } = parsed;

  if (leaf.isCa && leaf.sans.length === 0) {
    return Result.err(
      new CertificateInvalidError({
        message:
          "this looks like a CA certificate, not a server certificate — add it under Trusted CAs instead",
      }),
    );
  }

  const keyCheck = checkKeyMatchesCertificate(input.certPem, input.keyPem);
  if (!keyCheck.ok) return Result.err(new CertificateInvalidError({ message: keyCheck.error }));

  const requested = input.fixedHostname ?? input.hostname?.trim().toLowerCase();
  const derived = leaf.subjectCN ?? leaf.sans[0] ?? null;
  const hostname = requested ?? derived?.toLowerCase() ?? null;
  if (!hostname) {
    return Result.err(
      new CertificateInvalidError({
        message: "certificate has no usable hostname (no subject CN and no DNS SANs)",
      }),
    );
  }
  if (!certCoversDomain({ subjectCN: leaf.subjectCN, sans: leaf.sans }, hostname)) {
    return Result.err(
      new CertificateInvalidError({
        message: `certificate does not cover ${hostname} (subject ${leaf.subjectCN ?? "—"}, SANs ${
          leaf.sans.join(", ") || "—"
        })`,
      }),
    );
  }
  return Result.ok({ leaf, hostname });
}

export interface CustomCertWriteOutcome {
  certificate: CustomCertView;
  applied: boolean;
  applyError: string | null;
}

/**
 * Run the shared reconcile pass and record the REAL edge outcome on the row.
 * materializeCustomCerts (inside reconcile) flips the row to "error" itself
 * when the files can't be written; a global load failure is attributed to
 * this cert conservatively — it's excluded and the edge re-reconciled so a
 * bad upload can never leave other routes down.
 */
async function installAndReport(
  id: CustomCertificateId,
  organizationId: OrganizationId,
  rlog?: RequestLogger,
): Promise<{ applied: boolean; applyError: string | null }> {
  const result = await reconcile(rlog);

  // File materialization already failed? The row carries the honest reason.
  const afterMaterialize = await getCustomCertInOrg({ id, organizationId });
  if (afterMaterialize?.installState === "error") {
    return { applied: false, applyError: afterMaterialize.installError };
  }

  if (result.loadError) {
    const applyError = `the edge rejected the config including this certificate: ${result.loadError}`;
    await setCustomCertInstallOutcome({ id, installState: "error", installError: applyError });
    // Restore the edge without this cert (error rows are excluded).
    await reconcile(rlog);
    return { applied: false, applyError };
  }

  await setCustomCertInstallOutcome({ id, installState: "installed", installError: null });
  return { applied: true, applyError: null };
}

async function toView(
  id: CustomCertificateId,
  organizationId: OrganizationId,
): Promise<CustomCertView> {
  const [row, domainRows] = await Promise.all([
    getCustomCertInOrg({ id, organizationId }),
    listOrgEnabledHttpDomains(organizationId),
  ]);
  if (!row) throw panic(`certificates: row ${id} vanished mid-mutation`, undefined);
  const domains = [...new Set(domainRows.map((r) => r.domain))];
  return { ...row, matchingDomains: matchingDomainsFor(row, domains) };
}

export async function uploadCustomCertificate(
  input: {
    hostname?: string;
    certPem: string;
    keyPem: string;
    uploadedByUserId: UserId | null;
    rlog?: RequestLogger;
  } & OrgRef,
): Promise<Result<CustomCertWriteOutcome, CertificateInvalidError | CertificateConflictError>> {
  const validated = validateCustomCertMaterial(input);
  if (Result.isError(validated)) return Result.err(validated.error);
  const { leaf, hostname } = validated.value;

  const keyCiphertext = await encryptSecret(input.keyPem);
  const inserted = await Result.tryPromise({
    try: () =>
      insertCustomCert({
        organizationId: input.organizationId,
        uploadedByUserId: input.uploadedByUserId,
        hostname,
        certPem: input.certPem,
        keyCiphertext,
        issuer: leaf.issuer,
        subject: leaf.subject,
        serial: leaf.serial,
        sans: leaf.sans,
        notBefore: new Date(leaf.notBefore),
        notAfter: new Date(leaf.notAfter),
        fingerprint256: leaf.fingerprint256,
        keyAlg: leaf.keyAlg,
      }),
    catch: (cause) =>
      isUniqueViolation(cause)
        ? new CertificateConflictError({ hostname })
        : panic("certificates.uploadCustom: unexpected DB error", cause),
  });
  if (Result.isError(inserted)) return Result.err(inserted.error);
  if (!inserted.value) return Result.err(new CertificateConflictError({ hostname }));

  const outcome = await installAndReport(inserted.value.id, input.organizationId, input.rlog);
  return Result.ok({
    certificate: await toView(inserted.value.id, input.organizationId),
    ...outcome,
  });
}

export async function replaceCustomCertificate(
  input: {
    id: CustomCertificateId;
    certPem: string;
    keyPem: string;
    uploadedByUserId: UserId | null;
    rlog?: RequestLogger;
  } & OrgRef,
): Promise<Result<CustomCertWriteOutcome, CertificateInvalidError | CertificateNotFoundError>> {
  const existing = await getCustomCertInOrg({
    id: input.id,
    organizationId: input.organizationId,
  });
  if (!existing) return Result.err(new CertificateNotFoundError({ id: input.id }));

  const validated = validateCustomCertMaterial({
    certPem: input.certPem,
    keyPem: input.keyPem,
    fixedHostname: existing.hostname.toLowerCase(),
  });
  if (Result.isError(validated)) return Result.err(validated.error);
  const { leaf } = validated.value;

  const keyCiphertext = await encryptSecret(input.keyPem);
  await replaceCustomCertMaterial({
    id: input.id,
    organizationId: input.organizationId,
    uploadedByUserId: input.uploadedByUserId,
    material: {
      certPem: input.certPem,
      keyCiphertext,
      issuer: leaf.issuer,
      subject: leaf.subject,
      serial: leaf.serial,
      sans: leaf.sans,
      notBefore: new Date(leaf.notBefore),
      notAfter: new Date(leaf.notAfter),
      fingerprint256: leaf.fingerprint256,
      keyAlg: leaf.keyAlg,
    },
  });

  const outcome = await installAndReport(input.id, input.organizationId, input.rlog);
  return Result.ok({
    certificate: await toView(input.id, input.organizationId),
    ...outcome,
  });
}

export async function deleteCustomCertificate(
  input: { id: CustomCertificateId; rlog?: RequestLogger } & OrgRef,
): Promise<Result<{ ok: true }, CertificateNotFoundError>> {
  const deleted = await deleteCustomCertRecord({
    id: input.id,
    organizationId: input.organizationId,
  });
  if (!deleted) return Result.err(new CertificateNotFoundError({ id: input.id }));
  await removeCustomCertFiles(input.id);
  // Re-render the edge without this cert's tls directives — the covered
  // domains fall back to ACME / tls internal per their route flags.
  await reconcile(input.rlog);
  return Result.ok({ ok: true });
}

// ─── trusted CAs ────────────────────────────────────────────────────

export async function listTrustedCas(input: OrgRef): Promise<TrustedCaRecord[]> {
  return listTrustedCasByOrg(input.organizationId);
}

export async function uploadTrustedCa(
  input: { name: string; pem: string } & OrgRef,
): Promise<Result<TrustedCaRecord, TrustedCaInvalidError | TrustedCaConflictError>> {
  const parsed = parseCertificateChain(input.pem);
  if (!parsed.ok) return Result.err(new TrustedCaInvalidError({ message: parsed.error }));
  const { leaf } = parsed;
  if (!leaf.isCa) {
    return Result.err(
      new TrustedCaInvalidError({
        message:
          "this certificate is not a CA (basicConstraints CA:TRUE missing) — for a server certificate use Upload custom instead",
      }),
    );
  }

  const inserted = await Result.tryPromise({
    try: () =>
      insertTrustedCa({
        organizationId: input.organizationId,
        name: input.name.trim(),
        pem: input.pem,
        subject: leaf.subject,
        fingerprint256: leaf.fingerprint256,
        notAfter: new Date(leaf.notAfter),
      }),
    catch: (cause) =>
      isUniqueViolation(cause)
        ? new TrustedCaConflictError({ fingerprint: leaf.fingerprint256 })
        : panic("certificates.uploadCa: unexpected DB error", cause),
  });
  if (Result.isError(inserted)) return Result.err(inserted.error);
  if (!inserted.value) {
    return Result.err(new TrustedCaConflictError({ fingerprint: leaf.fingerprint256 }));
  }
  return Result.ok(inserted.value);
}

export async function deleteTrustedCa(
  input: { id: TrustedCaId } & OrgRef,
): Promise<Result<{ ok: true }, TrustedCaNotFoundError>> {
  const deleted = await deleteTrustedCaRecord({
    id: input.id,
    organizationId: input.organizationId,
  });
  if (!deleted) return Result.err(new TrustedCaNotFoundError({ id: input.id }));
  return Result.ok({ ok: true });
}
