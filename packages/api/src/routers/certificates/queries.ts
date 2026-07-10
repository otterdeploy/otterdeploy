import type {
  CustomCertificateId,
  OrganizationId,
  TrustedCaId,
  UserId,
} from "@otterdeploy/shared/id";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { user } from "@otterdeploy/db/schema/auth";
import { customCertificate, trustedCa } from "@otterdeploy/db/schema/certificates";
import { project } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { and, asc, desc, eq, isNull } from "drizzle-orm";

type OrgId = OrganizationId;

export type CustomCertificateRecord = InferSelectModel<typeof customCertificate>;
export type TrustedCaRecord = InferSelectModel<typeof trustedCa>;

/** Custom cert row + resolved uploader display name (left join — null when
 *  uploaded by an API key or the user is gone). */
export type CustomCertificateWithUploader = CustomCertificateRecord & {
  uploadedBy: string | null;
};

// ─── org domain enumeration (feeds the inventory probe) ─────────────

export interface OrgDomainRow {
  domain: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
}

/** Every enabled public (http) domain across the org's projects, with the
 *  publishing project. Preview-scoped routes are excluded — same filter the
 *  per-project certificates tab applies. A domain may appear once per
 *  project; callers group. */
export async function listOrgEnabledHttpDomains(organizationId: OrgId): Promise<OrgDomainRow[]> {
  return db
    .select({
      domain: proxyRoute.domain,
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
    })
    .from(proxyRoute)
    .innerJoin(project, eq(proxyRoute.projectId, project.id))
    .where(
      and(
        eq(project.organizationId, organizationId),
        eq(proxyRoute.type, "http"),
        eq(proxyRoute.enabled, true),
        isNull(proxyRoute.previewId),
      ),
    )
    .orderBy(asc(proxyRoute.domain));
}

// ─── custom certificates ────────────────────────────────────────────

export async function listCustomCertsByOrg(
  organizationId: OrgId,
): Promise<CustomCertificateWithUploader[]> {
  const rows = await db
    .select()
    .from(customCertificate)
    .leftJoin(user, eq(customCertificate.uploadedByUserId, user.id))
    .where(eq(customCertificate.organizationId, organizationId))
    .orderBy(desc(customCertificate.createdAt));
  return rows.map((r) => ({ ...r.custom_certificate, uploadedBy: r.user?.name ?? null }));
}

export async function getCustomCertInOrg(input: {
  id: CustomCertificateId;
  organizationId: OrgId;
}): Promise<CustomCertificateWithUploader | undefined> {
  const [row] = await db
    .select()
    .from(customCertificate)
    .leftJoin(user, eq(customCertificate.uploadedByUserId, user.id))
    .where(
      and(
        eq(customCertificate.id, input.id),
        eq(customCertificate.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  return { ...row.custom_certificate, uploadedBy: row.user?.name ?? null };
}

export interface CustomCertMaterial {
  hostname: string;
  certPem: string;
  keyCiphertext: string;
  issuer: string | null;
  subject: string | null;
  serial: string | null;
  sans: string[];
  notBefore: Date;
  notAfter: Date;
  fingerprint256: string;
  keyAlg: string | null;
}

export async function insertCustomCert(
  input: CustomCertMaterial & {
    organizationId: OrgId;
    uploadedByUserId: UserId | null;
  },
): Promise<CustomCertificateRecord | undefined> {
  const [row] = await db
    .insert(customCertificate)
    .values({ ...input, installState: "pending", installError: null })
    .returning();
  return row;
}

/** Replace the material in place (keeps id + hostname); resets the install
 *  lifecycle to "pending" so the outcome of the fresh install is reported. */
export async function replaceCustomCertMaterial(input: {
  id: CustomCertificateId;
  organizationId: OrgId;
  material: Omit<CustomCertMaterial, "hostname">;
  uploadedByUserId: UserId | null;
}): Promise<CustomCertificateRecord | undefined> {
  const [row] = await db
    .update(customCertificate)
    .set({
      ...input.material,
      uploadedByUserId: input.uploadedByUserId,
      installState: "pending",
      installError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(customCertificate.id, input.id),
        eq(customCertificate.organizationId, input.organizationId),
      ),
    )
    .returning();
  return row;
}

/** Record the real edge outcome after a reconcile attempt. */
export async function setCustomCertInstallOutcome(input: {
  id: CustomCertificateId;
  installState: "installed" | "error";
  installError: string | null;
}): Promise<void> {
  await db
    .update(customCertificate)
    .set({
      installState: input.installState,
      installError: input.installError,
      updatedAt: new Date(),
    })
    .where(eq(customCertificate.id, input.id));
}

export async function deleteCustomCertRecord(input: {
  id: CustomCertificateId;
  organizationId: OrgId;
}): Promise<{ id: CustomCertificateId } | undefined> {
  const [deleted] = await db
    .delete(customCertificate)
    .where(
      and(
        eq(customCertificate.id, input.id),
        eq(customCertificate.organizationId, input.organizationId),
      ),
    )
    .returning({ id: customCertificate.id });
  return deleted;
}

// ─── trusted CAs ────────────────────────────────────────────────────

export async function listTrustedCasByOrg(organizationId: OrgId): Promise<TrustedCaRecord[]> {
  return db
    .select()
    .from(trustedCa)
    .where(eq(trustedCa.organizationId, organizationId))
    .orderBy(desc(trustedCa.createdAt));
}

export async function insertTrustedCa(input: {
  organizationId: OrgId;
  name: string;
  pem: string;
  subject: string | null;
  fingerprint256: string;
  notAfter: Date;
}): Promise<TrustedCaRecord | undefined> {
  const [row] = await db.insert(trustedCa).values(input).returning();
  return row;
}

export async function deleteTrustedCaRecord(input: {
  id: TrustedCaId;
  organizationId: OrgId;
}): Promise<{ id: TrustedCaId } | undefined> {
  const [deleted] = await db
    .delete(trustedCa)
    .where(and(eq(trustedCa.id, input.id), eq(trustedCa.organizationId, input.organizationId)))
    .returning({ id: trustedCa.id });
  return deleted;
}
