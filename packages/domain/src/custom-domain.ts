import { Result } from "better-result";
import { db, eq, and } from "@otterdeploy/db";
import { customDomain } from "@otterdeploy/db/schema/operations";
import { resource } from "@otterdeploy/db/schema/project";
import { createLogger } from "@otterdeploy/logger";

import { NotFoundError, ConflictError } from "./errors";

const log = createLogger("domain:custom-domain");

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function formatDomain(row: typeof customDomain.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    resourceId: row.resourceId,
    domain: row.domain,
    verified: row.verified,
    sslStatus: row.sslStatus,
    sslExpiresAt: toISOString(row.sslExpiresAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateResource(
  resourceId: string,
  organizationId: string,
): Promise<Result<typeof resource.$inferSelect, NotFoundError>> {
  const row = await db.query.resource.findFirst({
    where: eq(resource.id, resourceId),
    with: {
      environment: { with: { project: true } },
    },
  });
  if (!row || row.environment.project.organizationId !== organizationId) {
    return Result.err(new NotFoundError({ resource: "resource", id: resourceId }));
  }
  return Result.ok(row);
}

async function validateDomainAccess(
  domainId: string,
  organizationId: string,
): Promise<Result<typeof customDomain.$inferSelect, NotFoundError>> {
  const row = await db.query.customDomain.findFirst({
    where: and(eq(customDomain.id, domainId), eq(customDomain.organizationId, organizationId)),
  });
  if (!row) return Result.err(new NotFoundError({ resource: "domain", id: domainId }));
  return Result.ok(row);
}

export async function addDomain(params: {
  organizationId: string;
  resourceId: string;
  domain: string;
}): Promise<Result<ReturnType<typeof formatDomain>, NotFoundError | ConflictError>> {
  const resResult = await validateResource(params.resourceId, params.organizationId);
  if (resResult.isErr()) return resResult;

  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    organizationId: params.organizationId,
    resourceId: params.resourceId,
    domain: params.domain,
    verified: false,
    verificationToken: crypto.randomUUID(),
    sslStatus: "pending" as const,
    sslExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const [inserted] = await db.insert(customDomain).values(row).returning();
  if (!inserted) {
    return Result.err(new ConflictError({ resource: "domain", detail: "Failed to add domain" }));
  }
  return Result.ok(formatDomain(inserted));
}

export async function verifyDomain(
  domainId: string,
  organizationId: string,
): Promise<Result<ReturnType<typeof formatDomain>, NotFoundError>> {
  const accessResult = await validateDomainAccess(domainId, organizationId);
  if (accessResult.isErr()) return accessResult;

  await db
    .update(customDomain)
    .set({ verified: true, updatedAt: new Date() })
    .where(eq(customDomain.id, domainId));

  const updated = await db.query.customDomain.findFirst({
    where: eq(customDomain.id, domainId),
  });
  return Result.ok(formatDomain(updated!));
}

export async function listDomains(params: { organizationId: string; resourceId?: string }) {
  const conditions = [eq(customDomain.organizationId, params.organizationId)];
  if (params.resourceId) {
    conditions.push(eq(customDomain.resourceId, params.resourceId));
  }

  const rows = await db.query.customDomain.findMany({
    where: and(...conditions),
  });

  return rows.map(formatDomain);
}

export async function removeDomain(
  domainId: string,
  organizationId: string,
): Promise<Result<{ success: true }, NotFoundError>> {
  const accessResult = await validateDomainAccess(domainId, organizationId);
  if (accessResult.isErr()) return accessResult;

  await db.delete(customDomain).where(eq(customDomain.id, domainId));
  return Result.ok({ success: true as const });
}

// ---------------------------------------------------------------------------
// DNS verification & domain resolution (Tasks 23-24)
// ---------------------------------------------------------------------------

// Known Cloudflare IPv4 ranges (partial, for detection)
const CLOUDFLARE_IPV4_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split("/");
  const mask = ~(2 ** (32 - Number(bits)) - 1);
  const ipNum = ip
    .split(".")
    .reduce((sum, octet) => (sum << 8) + Number(octet), 0);
  const rangeNum = range!
    .split(".")
    .reduce((sum, octet) => (sum << 8) + Number(octet), 0);
  return (ipNum & mask) === (rangeNum & mask);
}

function isCloudflareIp(ip: string): boolean {
  return CLOUDFLARE_IPV4_RANGES.some((cidr) => ipInCidr(ip, cidr));
}

/** DNS verification interface for dependency injection in tests. */
export interface DnsVerificationDeps {
  resolveTxt: (hostname: string) => Promise<string[][]>;
  resolve4: (hostname: string) => Promise<string[]>;
  resolveCname: (hostname: string) => Promise<string[]>;
}

const defaultDnsDeps: DnsVerificationDeps = {
  resolveTxt: async (hostname) => {
    const dns = await import("node:dns/promises");
    return dns.resolve(hostname, "TXT") as Promise<string[][]>;
  },
  resolve4: async (hostname) => {
    const dns = await import("node:dns/promises");
    return dns.resolve4(hostname);
  },
  resolveCname: async (hostname) => {
    const dns = await import("node:dns/promises");
    return dns.resolveCname(hostname);
  },
};

/**
 * Check whether a domain name is available within an organization.
 * Returns `{ available: true }` when no conflict exists, or
 * `{ available: false, conflictResourceId }` when a different domain row
 * already claims the same hostname.
 */
export async function checkDomainConflict(
  domain: string,
  organizationId: string,
  excludeDomainId?: string,
): Promise<Result<{ available: boolean; conflictResourceId?: string }, Error>> {
  try {
    const existing = await db.query.customDomain.findFirst({
      where: and(
        eq(customDomain.organizationId, organizationId),
        eq(customDomain.domain, domain),
      ),
    });

    if (existing && existing.id !== excludeDomainId) {
      return Result.ok({
        available: false,
        conflictResourceId: existing.resourceId,
      });
    }
    return Result.ok({ available: true });
  } catch (error) {
    return Result.err(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/**
 * Phase 1 — TXT record ownership verification.
 *
 * Looks for a TXT record at `_otterstack-verify.<domain>` whose value
 * matches the stored `verificationToken`.
 */
export async function verifyDomainOwnership(
  domainId: string,
  organizationId: string,
  deps: DnsVerificationDeps = defaultDnsDeps,
): Promise<
  Result<{ ownershipVerified: boolean; txtRecordFound: boolean }, NotFoundError>
> {
  const accessResult = await validateDomainAccess(domainId, organizationId);
  if (accessResult.isErr()) return accessResult;

  const domainRow = accessResult.value;
  const verificationHostname = `_otterstack-verify.${domainRow.domain}`;

  try {
    const records = await deps.resolveTxt(verificationHostname);
    const flatRecords = records.map((r) => r.join(""));
    const found = flatRecords.includes(domainRow.verificationToken!);

    if (found) {
      await db
        .update(customDomain)
        .set({ updatedAt: new Date() })
        .where(eq(customDomain.id, domainId));
    }

    log.info(
      { domainId, hostname: verificationHostname, found },
      "TXT ownership check completed",
    );

    return Result.ok({
      ownershipVerified: found,
      txtRecordFound: flatRecords.length > 0,
    });
  } catch {
    // DNS resolution failure (ENOTFOUND, etc.) means no TXT record
    return Result.ok({
      ownershipVerified: false,
      txtRecordFound: false,
    });
  }
}

/**
 * Phase 2 — A/CNAME traffic-readiness check.
 *
 * Resolves the domain's A and CNAME records and checks whether
 * they point to the expected server IP. Also detects Cloudflare
 * proxy usage.
 */
export async function checkDnsTrafficReadiness(
  domainId: string,
  organizationId: string,
  serverIp: string,
  deps: DnsVerificationDeps = defaultDnsDeps,
): Promise<
  Result<
    {
      pointsToServer: boolean;
      behindCloudflare: boolean;
      resolvedIps: string[];
      cnames: string[];
      warnings: string[];
    },
    NotFoundError
  >
> {
  const accessResult = await validateDomainAccess(domainId, organizationId);
  if (accessResult.isErr()) return accessResult;

  const domainRow = accessResult.value;
  const warnings: string[] = [];
  let resolvedIps: string[] = [];
  let cnames: string[] = [];
  let pointsToServer = false;
  let behindCloudflare = false;

  try {
    // Try CNAME first
    try {
      cnames = await deps.resolveCname(domainRow.domain);
    } catch {
      // No CNAME record
    }

    // Try A record
    try {
      resolvedIps = await deps.resolve4(domainRow.domain);
    } catch {
      // No A record
    }

    // Check if any IP matches server
    pointsToServer = resolvedIps.includes(serverIp);

    // Check for Cloudflare proxy
    behindCloudflare = resolvedIps.some(isCloudflareIp);

    if (behindCloudflare) {
      warnings.push(
        "Domain appears to be behind Cloudflare proxy. Set SSL mode to 'Full (Strict)' in Cloudflare.",
      );
      warnings.push(
        "A/CNAME check cannot verify origin server when behind Cloudflare proxy.",
      );
    }

    if (!pointsToServer && !behindCloudflare && resolvedIps.length > 0) {
      warnings.push(
        `Domain resolves to ${resolvedIps.join(", ")} but server IP is ${serverIp}. Traffic may not route correctly.`,
      );
    }

    if (resolvedIps.length === 0 && cnames.length === 0) {
      warnings.push(
        "No A or CNAME records found for this domain. DNS is not configured.",
      );
    }

    log.info(
      { domainId, pointsToServer, behindCloudflare, resolvedIps, cnames },
      "DNS traffic readiness check completed",
    );

    return Result.ok({
      pointsToServer,
      behindCloudflare,
      resolvedIps,
      cnames,
      warnings,
    });
  } catch (error) {
    return Result.err(
      error instanceof Error
        ? new NotFoundError({ resource: "domain", id: domainId })
        : new NotFoundError({ resource: "domain", id: domainId }),
    );
  }
}

/**
 * Full domain verification — runs both ownership (Phase 1) and
 * traffic-readiness (Phase 2) checks.
 *
 * If ownership verification passes the domain row is marked
 * `verified = true`.
 */
export async function verifyDomainFull(
  domainId: string,
  organizationId: string,
  serverIp: string,
  deps: DnsVerificationDeps = defaultDnsDeps,
): Promise<
  Result<
    {
      verified: boolean;
      ownershipVerified: boolean;
      trafficReady: boolean;
      warnings: string[];
    },
    NotFoundError
  >
> {
  // Phase 1: Ownership
  const ownershipResult = await verifyDomainOwnership(
    domainId,
    organizationId,
    deps,
  );
  if (ownershipResult.isErr()) return ownershipResult;

  const { ownershipVerified } = ownershipResult.value;

  // Phase 2: Traffic readiness (advisory only)
  const trafficResult = await checkDnsTrafficReadiness(
    domainId,
    organizationId,
    serverIp,
    deps,
  );
  const trafficReady = trafficResult.isOk()
    ? trafficResult.value.pointsToServer
    : false;
  const warnings = trafficResult.isOk()
    ? trafficResult.value.warnings
    : [];

  if (ownershipVerified) {
    await db
      .update(customDomain)
      .set({ verified: true, updatedAt: new Date() })
      .where(eq(customDomain.id, domainId));

    log.info({ domainId }, "Domain marked as verified");
  }

  return Result.ok({
    verified: ownershipVerified,
    ownershipVerified,
    trafficReady,
    warnings,
  });
}

/**
 * Three-level domain resolution.
 *
 * Priority:
 *   1. Verified custom domain on the resource
 *   2. `<resource-name>.<project-base-domain>`
 *   3. `<resource-name>-<project-slug>.<server-base-domain>`
 */
export function resolveResourceDomain(
  resource: { name: string; id: string },
  project: { slug: string; baseDomain: string | null },
  server: { baseDomain: string | null },
  customDomains: { domain: string; verified: boolean }[],
): string | null {
  // Level 1: Resource custom domain
  const verifiedCustom = customDomains.find((d) => d.verified);
  if (verifiedCustom) return verifiedCustom.domain;

  // Level 2: Project base domain
  if (project.baseDomain) {
    return `${resource.name}.${project.baseDomain}`;
  }

  // Level 3: Server base domain
  if (server.baseDomain) {
    return `${resource.name}-${project.slug}.${server.baseDomain}`;
  }

  return null;
}

/**
 * Update SSL certificate status for a domain.
 */
export async function updateSslStatus(
  domainId: string,
  organizationId: string,
  sslStatus: "pending" | "active" | "failed" | "expired",
  sslExpiresAt?: Date,
): Promise<Result<ReturnType<typeof formatDomain>, NotFoundError>> {
  const accessResult = await validateDomainAccess(domainId, organizationId);
  if (accessResult.isErr()) return accessResult;

  const updateData: Record<string, unknown> = {
    sslStatus,
    updatedAt: new Date(),
  };
  if (sslExpiresAt) updateData.sslExpiresAt = sslExpiresAt;

  await db
    .update(customDomain)
    .set(updateData)
    .where(eq(customDomain.id, domainId));

  const updated = await db.query.customDomain.findFirst({
    where: eq(customDomain.id, domainId),
  });
  return Result.ok(formatDomain(updated!));
}

/**
 * Persist redirect rules for a domain (e.g. www -> apex).
 */
export async function updateRedirectRules(
  domainId: string,
  organizationId: string,
  redirectRules: Array<{
    source: string;
    target: string;
    statusCode: 301 | 302;
    type: "www" | "custom";
  }>,
): Promise<Result<ReturnType<typeof formatDomain>, NotFoundError>> {
  const accessResult = await validateDomainAccess(domainId, organizationId);
  if (accessResult.isErr()) return accessResult;

  await db
    .update(customDomain)
    .set({ redirectRules, updatedAt: new Date() })
    .where(eq(customDomain.id, domainId));

  const updated = await db.query.customDomain.findFirst({
    where: eq(customDomain.id, domainId),
  });
  return Result.ok(formatDomain(updated!));
}
