/**
 * The `mesh.status` wire shape and everything that produces it: the
 * never-connected default, the row → view projection, and the stranded-route
 * count that makes "the mesh is down" an honest number instead of a shrug.
 *
 * Split out of ./handlers so that file reads as the connect / verify /
 * disconnect / list lifecycle. This module owns the *view*. It is the single
 * place a new status field gets added, and the only place that decides what an
 * org with no mesh looks like (rule 1 of the design: absence is normal, never
 * an error).
 *
 * Design: docs/designs/vpn-mesh.md
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, proxyRoute } from "@otterdeploy/db/schema";
import { and, count, eq, ne } from "drizzle-orm";

import type { MeshIdentity } from "../../mesh";
import type { MeshNetworkRecord } from "./queries";

import { NETBIRD_HOSTED_URL, normalizeManagementUrl, privateHostFor } from "../../mesh";

/** The `mesh.status` wire shape. */
export interface MeshStatusView {
  connected: boolean;
  provider: "netbird" | "tailscale" | null;
  status: "connected" | "error" | "disconnected" | null;
  managementUrl: string | null;
  selfHosted: boolean;
  accountLabel: string | null;
  peerDomain: string | null;
  peerDomainSource: "account-settings" | "peer-dns-label" | "default" | null;
  dnsLabel: string | null;
  privateHostExample: string | null;
  accessGroupIds: string[];
  lastVerifiedAt: Date | null;
  lastError: string | null;
  peerCount: number | null;
  strandedPrivateRoutes: number;
}

/** Status for an org that has never connected anything. Not an error state. */
export const DISCONNECTED_STATUS: MeshStatusView = {
  connected: false,
  provider: null,
  status: null,
  managementUrl: null,
  selfHosted: false,
  accountLabel: null,
  peerDomain: null,
  peerDomainSource: null,
  dnsLabel: null,
  privateHostExample: null,
  accessGroupIds: [],
  lastVerifiedAt: null,
  lastError: null,
  peerCount: null,
  strandedPrivateRoutes: 0,
};

/**
 * Routes still marked private (or dual-scoped) in an org. Called when the mesh
 * is not usable, where the number means "this many apps are currently
 * unreachable on their private host": the honest framing, since we refuse to
 * silently republish them to the internet.
 */
export async function countPrivateRoutes(organizationId: OrganizationId): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(proxyRoute)
    .innerJoin(project, eq(project.id, proxyRoute.projectId))
    .where(and(eq(project.organizationId, organizationId), ne(proxyRoute.exposureScope, "public")));
  return row?.value ?? 0;
}

function isSelfHosted(managementUrl: string): boolean {
  return normalizeManagementUrl(managementUrl) !== normalizeManagementUrl(NETBIRD_HOSTED_URL);
}

/** Build the wire view from a row, optionally enriched by a live verify. */
export function toStatusView(
  row: MeshNetworkRecord,
  extras: {
    identity?: MeshIdentity | null;
    strandedPrivateRoutes: number;
  },
): MeshStatusView {
  const peerDomain = extras.identity?.peerDomain ?? row.peerDomain;
  return {
    connected: row.status === "connected",
    provider: row.provider,
    status: row.status,
    managementUrl: row.managementUrl,
    selfHosted: isSelfHosted(row.managementUrl),
    accountLabel: extras.identity?.accountLabel ?? null,
    peerDomain,
    peerDomainSource: extras.identity?.peerDomainSource ?? null,
    dnsLabel: row.dnsLabel,
    privateHostExample:
      peerDomain && row.dnsLabel
        ? privateHostFor({
            provider: row.provider,
            serviceSlug: "api",
            projectSlug: "my-project",
            dnsLabel: row.dnsLabel,
            peerDomain,
          })
        : null,
    accessGroupIds: row.accessGroupIds ?? [],
    lastVerifiedAt: row.lastVerifiedAt,
    lastError: row.lastError,
    peerCount: extras.identity?.peerCount ?? null,
    strandedPrivateRoutes: extras.strandedPrivateRoutes,
  };
}
