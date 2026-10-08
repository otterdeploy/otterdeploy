/**
 * An uploaded certificate is not "self-signed".
 *
 * A route the edge serves with an operator-uploaded chain keeps
 * `uses_acme = false`: the reconciler matches the certificate to the host at
 * render time (caddy/certs.ts) and never writes the fact onto the row. Every
 * surface that read the flag alone therefore labelled such a host
 * "Self-signed", the exact inverse of marking generated hosts self-signed.
 *
 * Real query modules against a migrated Postgres: the domain list and the
 * project's custom-certificate host set must both see the upload, scoped to
 * the uploading organization, and ignore a certificate that failed to install.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { createRouterClient } from "@orpc/server";
import { db } from "@otterdeploy/db";
import { customCertificate } from "@otterdeploy/db/schema/certificates";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { appRouter } from "../..";
import { createKeyContext, createMemberContext } from "../../../__tests__/postgres-actors";
import { seedOrganization, seedProject, seedService, uniq } from "../../../__tests__/postgres-seed";
import { listProjectCustomCertHosts } from "../../project/proxy-route-certs";
import { listServiceDomains } from "../domains-check";

let organizationId: OrganizationId;
let otherOrganizationId: OrganizationId;
let projectId: ProjectId;
let resourceId: ResourceId;
const suffix = uniq();
const uploaded = `app-${suffix}.example.org`;
const wildcardCovered = `api-${suffix}.example.net`;
const foreign = `shop-${suffix}.example.org`;
const failed = `docs-${suffix}.example.org`;
const plain = `web-${suffix}.example.org`;

async function insertCert(input: {
  organizationId: OrganizationId;
  hostname: string;
  sans: string[];
  installState?: "pending" | "installed" | "error";
}): Promise<void> {
  // drizzle's timestamp columns are `Date`: the library seam the row demands.
  const now = new Date();
  await db.insert(customCertificate).values({
    organizationId: input.organizationId,
    hostname: input.hostname,
    certPem: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n",
    keyCiphertext: "test",
    subject: `CN=${input.hostname}`,
    sans: input.sans,
    notBefore: now,
    notAfter: new Date(now.getTime() + 90 * 86_400_000),
    fingerprint256: `AA:${uniq()}`,
    installState: input.installState ?? "installed",
  });
}

async function insertRoute(domain: string): Promise<void> {
  await db.insert(proxyRoute).values({
    projectId,
    resourceId,
    type: "http",
    domain,
    upstreamHost: "od-web",
    upstreamPort: 8080,
    protocol: "http",
    source: "custom",
    usesAcme: false,
    domainVerifiedAt: new Date(),
  });
}

beforeAll(async () => {
  organizationId = await seedOrganization("cert-src");
  otherOrganizationId = await seedOrganization("cert-src-other");
  const project = await seedProject(organizationId);
  projectId = project.projectId;
  const service = await seedService({
    projectId,
    environmentId: project.mainEnvironmentId,
    name: `web-${suffix}`,
  });
  resourceId = service.resourceId;

  for (const domain of [uploaded, wildcardCovered, foreign, failed, plain]) {
    await insertRoute(domain);
  }
  await insertCert({ organizationId, hostname: uploaded, sans: [uploaded] });
  // Covers by wildcard SAN, not by its stored hostname.
  await insertCert({
    organizationId,
    hostname: `www-${suffix}.example.net`,
    sans: [`www-${suffix}.example.net`, "*.example.net"],
  });
  // Another organization's certificate is never served on this org's host.
  await insertCert({ organizationId: otherOrganizationId, hostname: foreign, sans: [foreign] });
  // Excluded from the edge after a failed install, so not served either.
  await insertCert({ organizationId, hostname: failed, sans: [failed], installState: "error" });
});

describe("certificate source of a route with an uploaded certificate", () => {
  it("the domain list says custom only where this org's installed certificate covers the host", async () => {
    const result = await listServiceDomains({ organizationId, projectId, resourceId });
    if (result.isErr()) throw result.error;
    const bySource = new Map(result.value.map((d) => [d.domain, d.certSource]));
    expect(Object.fromEntries(bySource)).toEqual({
      [uploaded]: "custom",
      [wildcardCovered]: "custom",
      [foreign]: "internal",
      [failed]: "internal",
      [plain]: "internal",
    });
  });

  it("the project's custom-certificate hosts are the same set", async () => {
    const result = await listProjectCustomCertHosts({ organizationId, projectId });
    if (result.isErr()) throw result.error;
    expect(result.value).toEqual([wildcardCovered, uploaded].toSorted());
  });

  it("the procedure answers the same over a session and an API key", async () => {
    const session = createRouterClient(appRouter, {
      context: await createMemberContext(organizationId),
    });
    const apiKey = createRouterClient(appRouter, {
      context: createKeyContext(organizationId, null),
    });
    const expected = [wildcardCovered, uploaded].toSorted();
    expect(await session.project.proxyRoute.customCertHosts({ projectId })).toEqual(expected);
    expect(await apiKey.project.proxyRoute.customCertHosts({ projectId })).toEqual(expected);
  });

  it("another organization cannot read the project's hosts", async () => {
    const result = await listProjectCustomCertHosts({
      organizationId: otherOrganizationId,
      projectId,
    });
    expect(result.isErr()).toBe(true);
  });
});
