/**
 * On a real install every route's cert_state stayed "unknown"
 * behind a live Let's Encrypt certificate.
 *
 * Two causes, both checked here against a migrated Postgres:
 *  1. The issuance line Caddy actually writes names its domain in
 *     `identifier`, which the edge-log parser did not read, so the promoter
 *     matched no route. The verbatim line now goes through the real parser
 *     and promoter.
 *  2. Nothing re-read the state if the issuance line was never seen (cert
 *     obtained before an upgrade, sink not listening). The probe pass settles
 *     it from the served certificate. Only the TLS handshake is stood in for:
 *     there is no publicly trusted certificate to serve in a test.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { closeQueues } from "@otterdeploy/jobs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { CertProbe } from "../../../lib/cert-probe";

import { seedOrganization, seedProject, seedService, uniq } from "../../../__tests__/postgres-seed";
import { promoteCertEvent } from "../../../edge-logs/cert-promote";
import { parseCaddyEvent } from "../../../edge-logs/event-parse";
import { type CertStateProbeDeps, probeCertStatesOnce } from "../cert-state-probe";

const { redisUrl } = vi.hoisted(() => {
  /* oxlint-disable node/no-process-env -- test env boundary: route-upsert pushes and cert.renewed need the opt-in integration Redis */
  const url = process.env.INTEGRATION_REDIS_URL;
  if (url) process.env.REDIS_URL = url;
  /* oxlint-enable node/no-process-env */
  return { redisUrl: url };
});

let organizationId: OrganizationId;
let projectId: ProjectId;
let resourceId: ResourceId;
const suffix = uniq();
const NOW = Date.parse("2026-10-09T12:00:00Z");
const HOUR = 3_600_000;

type CertState = (typeof proxyRoute.$inferSelect)["certState"];

async function insertRoute(input: {
  domain: string;
  usesAcme?: boolean;
  certState?: CertState;
  certCheckedAt?: Date | null;
}) {
  const [row] = await db
    .insert(proxyRoute)
    .values({
      projectId,
      resourceId,
      type: "http",
      domain: input.domain,
      upstreamHost: "od-web",
      upstreamPort: 8080,
      protocol: "http",
      source: "custom",
      usesAcme: input.usesAcme ?? true,
      certState: input.certState ?? "unknown",
      certCheckedAt: input.certCheckedAt ?? null,
      // drizzle's timestamp columns are `Date`: the library seam the row demands.
      domainVerifiedAt: new Date(NOW),
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

async function readRoute(domain: string) {
  const [row] = await db.select().from(proxyRoute).where(eq(proxyRoute.domain, domain));
  if (!row) throw new Error(`route ${domain} vanished`);
  return row;
}

function served(domain: string, overrides: Partial<CertProbe> = {}): CertProbe {
  return {
    domain,
    ok: true,
    error: null,
    issuer: "Let's Encrypt",
    subject: domain,
    sans: [domain],
    notBefore: "2026-10-09T00:00:00.000Z",
    notAfter: "2027-01-07T00:00:00.000Z",
    daysRemaining: 89,
    serial: "04",
    fingerprint: "AA:BB",
    selfSigned: false,
    status: "valid",
    ...overrides,
  };
}

beforeAll(async () => {
  if (!redisUrl) return;
  organizationId = await seedOrganization("cert-probe");
  const project = await seedProject(organizationId);
  projectId = project.projectId;
  const service = await seedService({
    projectId,
    environmentId: project.mainEnvironmentId,
    name: `web-${suffix}`,
  });
  resourceId = service.resourceId;
});

afterAll(async () => {
  if (!redisUrl) return;
  await closeQueues();
});

describe.skipIf(!redisUrl)("cert_state from Caddy's issuance line", () => {
  it("the verbatim `certificate obtained successfully` line makes the route valid", async () => {
    const domain = `whoami-${suffix}.example.org`;
    await insertRoute({ domain });
    const event = parseCaddyEvent({
      level: "info",
      ts: NOW / 1000,
      logger: "tls.obtain",
      msg: "certificate obtained successfully",
      identifier: domain,
      issuer: "acme-v02.api.letsencrypt.org-directory",
    });
    if (!event) throw new Error("the issuance line was dropped");
    await promoteCertEvent(event);
    expect((await readRoute(domain)).certState).toBe("valid");
  });

  it("the verbatim issuer error makes the route failed, with Caddy's reason", async () => {
    const domain = `ratelimited-${suffix}.example.org`;
    await insertRoute({ domain });
    const event = parseCaddyEvent({
      level: "error",
      ts: NOW / 1000,
      logger: "tls.obtain",
      msg: "could not get certificate from issuer",
      identifier: domain,
      issuer: "acme-v02.api.letsencrypt.org-directory",
      error: "HTTP 429 urn:ietf:params:acme:error:rateLimited - too many certificates",
    });
    if (!event) throw new Error("the issuer error was dropped");
    await promoteCertEvent(event);
    const row = await readRoute(domain);
    expect(row.certState).toBe("failed");
    expect(row.certError).toContain("rateLimited");
  });
});

describe.skipIf(!redisUrl)("cert_state probe pass", () => {
  it("settles routes from the served certificate, and leaves alone what it cannot prove", async () => {
    const live = `live-${suffix}.example.org`;
    const lapsed = `lapsed-${suffix}.example.org`;
    const pending = `pending-${suffix}.example.org`;
    const internal = `internal-${suffix}.example.org`;
    const fresh = `fresh-${suffix}.example.org`;
    const stale = `stale-${suffix}.example.org`;
    const broken = `broken-${suffix}.example.org`;

    // A cert issued before anything was listening: still "unknown".
    await insertRoute({ domain: live });
    // A valid cert that has since lapsed, last checked a day ago.
    await insertRoute({
      domain: lapsed,
      certState: "valid",
      certCheckedAt: new Date(NOW - 24 * HOUR),
    });
    // ACME issuance in flight: the edge still serves its interim cert.
    await insertRoute({ domain: pending, certState: "obtaining" });
    // `tls internal`: self-signed by design, never probed.
    await insertRoute({ domain: internal, usesAcme: false });
    // Confirmed valid an hour ago: not due.
    await insertRoute({ domain: fresh, certState: "valid", certCheckedAt: new Date(NOW - HOUR) });
    // Confirmed valid long ago, still valid: re-confirmed quietly.
    await insertRoute({
      domain: stale,
      certState: "valid",
      certCheckedAt: new Date(NOW - 13 * HOUR),
    });
    // A failure reported by Caddy's log is the log's to clear.
    await insertRoute({ domain: broken, certState: "failed" });

    const probed = new Set<string>();
    const deps: CertStateProbeDeps = {
      now: () => NOW,
      edgeHost: async () => "203.0.113.10",
      probe: async ({ domain }) => {
        probed.add(domain);
        if (domain === live || domain === stale) return { probe: served(domain), trustError: null };
        if (domain === lapsed) {
          return {
            probe: served(domain, {
              status: "expired",
              notAfter: "2026-10-01T00:00:00.000Z",
              daysRemaining: -8,
            }),
            trustError: "CERT_HAS_EXPIRED",
          };
        }
        if (domain === pending) {
          return {
            probe: served(domain, {
              issuer: "Caddy Local Authority",
              selfSigned: true,
              status: "internal",
            }),
            trustError: "SELF_SIGNED_CERT_IN_CHAIN",
          };
        }
        // Any other install route in the shared database: no handshake.
        return { probe: served(domain, { ok: false, status: "error" }), trustError: null };
      },
    };

    // The pass is batched and oldest-check-first; other suites' routes share
    // this database, so run passes until ours have all been seen.
    const ours = [live, lapsed, pending, stale];
    for (let pass = 0; pass < 20 && !ours.every((d) => probed.has(d)); pass += 1) {
      await probeCertStatesOnce(deps);
    }

    expect((await readRoute(live)).certState).toBe("valid");
    expect((await readRoute(live)).certCheckedAt?.getTime()).toBe(NOW);

    const lapsedRow = await readRoute(lapsed);
    expect(lapsedRow.certState).toBe("failed");
    expect(lapsedRow.certError).toContain("2026-10-01");

    const pendingRow = await readRoute(pending);
    expect(pendingRow.certState).toBe("obtaining");
    expect(pendingRow.certCheckedAt?.getTime()).toBe(NOW);

    expect((await readRoute(stale)).certState).toBe("valid");
    expect((await readRoute(stale)).certCheckedAt?.getTime()).toBe(NOW);

    for (const untouched of [internal, fresh, broken]) expect(probed.has(untouched)).toBe(false);
    expect((await readRoute(broken)).certState).toBe("failed");

    // Re-run right away: the unsettled route is not due again for two minutes.
    probed.clear();
    await probeCertStatesOnce(deps);
    expect(probed.has(pending)).toBe(false);
  });
});
