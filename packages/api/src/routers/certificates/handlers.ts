/**
 * Certificates business logic — the custom-certificate write path.
 *
 * Custom certs are validated with node:crypto (chain parses, key pairs with
 * the leaf, hostname covered — see validate.ts), the key is AES-GCM-encrypted
 * at rest (same helper as registry passwords / SSH private keys), and
 * installation goes through the SAME reconcile pass every route change uses:
 * files are materialized under the edge's /etc/caddy mount and `tls`
 * directives emitted per matching route. The reported `applied` /
 * `installState` is the real outcome of that pass — a cert that couldn't be
 * written or that the edge rejected says so, it is never shown as live.
 *
 * Live inventory probes live in inventory.ts; the trusted-CA store in
 * trusted-cas.ts — both re-exported here so the router's import seam is
 * unchanged.
 */
import type { CustomCertificateId, OrganizationId, UserId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result, panic } from "better-result";

import type { OrgRef } from "../scopes";
import type { CustomCertificateWithUploader } from "./queries";

import { reconcile } from "../../caddy";
import { removeCustomCertFiles } from "../../caddy/certs";
import { encryptSecret } from "../../lib/crypto";
import { isUniqueViolation } from "../project/views";
import {
  CertificateConflictError,
  CertificateInvalidError,
  CertificateNotFoundError,
} from "./errors";
import {
  deleteCustomCertRecord,
  getCustomCertInOrg,
  insertCustomCert,
  listCustomCertsByOrg,
  listOrgEnabledHttpDomains,
  replaceCustomCertMaterial,
  setCustomCertInstallOutcome,
} from "./queries";
import { matchingDomainsFor, validateCustomCertMaterial } from "./validate";

export * from "./inventory";
export * from "./trusted-cas";

export type CustomCertView = CustomCertificateWithUploader & { matchingDomains: string[] };

export async function listCustomCertificates(input: OrgRef): Promise<CustomCertView[]> {
  const [certs, domainRows] = await Promise.all([
    listCustomCertsByOrg(input.organizationId),
    listOrgEnabledHttpDomains(input.organizationId),
  ]);
  const domains = [...new Set(domainRows.map((r) => r.domain))];
  return certs.map((c) => ({ ...c, matchingDomains: matchingDomainsFor(c, domains) }));
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
