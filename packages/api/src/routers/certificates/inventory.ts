/**
 * Org-wide certificate inventory — live TLS probes of every enabled public
 * domain in the org (the exact probe the per-project Networking tab uses).
 * Ground truth, never cached; served leaves are tagged with any stored
 * custom cert whose fingerprint matches. Split out of handlers.ts, which
 * keeps the custom-certificate write path.
 */
import type { CustomCertificateId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { eq } from "drizzle-orm";

import type { OrgRef } from "../scopes";
import type { OrgDomainRow } from "./queries";

import { type CertProbe, probeCertificate } from "../../lib/cert-probe";
import { listCustomCertsByOrg, listOrgEnabledHttpDomains } from "./queries";

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
