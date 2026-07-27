/**
 * Private-networking handlers — connect / verify / disconnect the org's own
 * VPN account, and read back the facts the UI and the data plane need.
 *
 * Two rules run through all of this:
 *   1. Absence is normal. An org with no mesh is fully supported and gets a
 *      `connected: false` status, never an error.
 *   2. Losing the mesh never changes what's reachable. Disconnecting flips a
 *      status; it does not re-expose private routes to the internet and does
 *      not delete peers. Stranded routes are counted and surfaced so the
 *      operator decides.
 *
 * Design: docs/designs/vpn-mesh.md
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, proxyRoute, server } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { and, count, eq, inArray, ne } from "drizzle-orm";

import type { MeshGroup, MeshIdentity, MeshPeer, MeshProviderClient } from "../../mesh";

import { encryptForDomain } from "../../lib/crypto";
import {
  createMeshClient,
  MeshProviderError,
  NETBIRD_HOSTED_URL,
  normalizeManagementUrl,
  privateHostFor,
} from "../../mesh";
import {
  disconnectMeshNetwork,
  getMeshNetwork,
  type MeshNetworkRecord,
  patchMeshVerification,
  setMeshAccessGroups,
  upsertMeshNetwork,
} from "./queries";

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
const DISCONNECTED_STATUS: MeshStatusView = {
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
 * unreachable on their private host" — the honest framing, since we refuse to
 * silently republish them to the internet.
 */
async function countPrivateRoutes(organizationId: OrganizationId): Promise<number> {
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
function toStatusView(
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

export async function getMeshStatus(organizationId: OrganizationId): Promise<MeshStatusView> {
  const row = await getMeshNetwork(organizationId);
  if (!row) return DISCONNECTED_STATUS;
  // A live status read stays cheap and offline — we don't call the provider on
  // every page load. `verify` is the explicit round-trip.
  return toStatusView(row, {
    strandedPrivateRoutes:
      row.status === "connected" ? 0 : await countPrivateRoutes(organizationId),
  });
}

/**
 * Load the row AND a ready provider client, or fail with a reason the UI can
 * render. Used by every call that has to talk to the provider.
 */
async function loadMeshClient(
  organizationId: OrganizationId,
): Promise<Result<{ row: MeshNetworkRecord; client: MeshProviderClient }, MeshProviderError>> {
  const row = await getMeshNetwork(organizationId);
  if (!row || row.status === "disconnected" || !row.apiTokenCiphertext) {
    return Result.err(
      new MeshProviderError({
        provider: row?.provider ?? "netbird",
        status: null,
        message: "No private network is connected for this organization.",
      }),
    );
  }
  try {
    const client = await createMeshClient(row);
    return Result.ok({ row, client });
  } catch (err) {
    return Result.err(asProviderError(err, row.provider));
  }
}

function asProviderError(err: unknown, provider: "netbird" | "tailscale"): MeshProviderError {
  if (err instanceof MeshProviderError) return err;
  return new MeshProviderError({
    provider,
    status: null,
    message: err instanceof Error ? err.message : String(err),
  });
}

export interface ConnectMeshInput {
  organizationId: OrganizationId;
  provider: "netbird" | "tailscale";
  managementUrl?: string;
  apiToken: string;
  oauthClientId?: string;
  dnsLabel: string;
}

/**
 * Connect (or re-connect) the org's account.
 *
 * Verification happens BEFORE anything is persisted, so a bad token never
 * leaves a half-connected row behind that the operator then has to clean up.
 */
export async function connectMesh(
  input: ConnectMeshInput,
): Promise<Result<MeshStatusView, MeshProviderError>> {
  const managementUrl = normalizeManagementUrl(input.managementUrl?.trim() || NETBIRD_HOSTED_URL);
  const apiTokenCiphertext = await encryptForDomain(input.apiToken, "mesh-creds");

  let identity: MeshIdentity;
  let nodeGroupId: string | null = null;
  try {
    const client = await createMeshClient({
      provider: input.provider,
      managementUrl,
      apiTokenCiphertext,
    });
    identity = await client.verify();
    // Idempotent: a re-connect reuses the group the org's peers already sit in
    // rather than fragmenting them across duplicates.
    nodeGroupId = (await client.ensureGroup("otterdeploy-nodes")).id;
  } catch (err) {
    return Result.err(asProviderError(err, input.provider));
  }

  const row = await upsertMeshNetwork({
    organizationId: input.organizationId,
    provider: input.provider,
    managementUrl,
    apiTokenCiphertext,
    oauthClientId: input.oauthClientId ?? null,
    accountId: identity.accountId,
    peerDomain: identity.peerDomain,
    dnsLabel: input.dnsLabel,
    nodeGroupId,
  });

  return Result.ok(toStatusView(row, { identity, strandedPrivateRoutes: 0 }));
}

/** Re-run whoami against the stored credential and record the outcome. */
export async function verifyMesh(
  organizationId: OrganizationId,
): Promise<Result<MeshStatusView, MeshProviderError>> {
  const loaded = await loadMeshClient(organizationId);
  if (loaded.isErr()) return Result.err(loaded.error);
  const { row, client } = loaded.value;

  try {
    const identity = await client.verify();
    await patchMeshVerification({
      organizationId,
      status: "connected",
      lastError: null,
      peerDomain: identity.peerDomain,
      accountId: identity.accountId,
    });
    return Result.ok(
      toStatusView(
        { ...row, status: "connected", lastError: null, lastVerifiedAt: new Date() },
        { identity, strandedPrivateRoutes: 0 },
      ),
    );
  } catch (err) {
    const error = asProviderError(err, row.provider);
    // Record the failure but KEEP the row: private routes stay private, and
    // the operator gets a re-authenticate path instead of losing the config.
    await patchMeshVerification({
      organizationId,
      status: "error",
      lastError: error.message,
    });
    return Result.err(error);
  }
}

/**
 * Disconnect. Peers keep running and private routes stay private — this is
 * deliberately not a teardown. See the design's "optional, opt-out, never
 * load-bearing" section: the one thing disconnect must never do is quietly
 * put an internal-only app back on the public internet.
 */
export async function disconnectMesh(organizationId: OrganizationId): Promise<MeshStatusView> {
  const row = await getMeshNetwork(organizationId);
  if (!row) return DISCONNECTED_STATUS;
  await disconnectMeshNetwork(organizationId);
  return toStatusView(
    { ...row, status: "disconnected", apiTokenCiphertext: "" },
    { strandedPrivateRoutes: await countPrivateRoutes(organizationId) },
  );
}

export async function listMeshGroups(
  organizationId: OrganizationId,
): Promise<Result<MeshGroup[], MeshProviderError>> {
  const loaded = await loadMeshClient(organizationId);
  if (loaded.isErr()) return Result.err(loaded.error);
  try {
    return Result.ok(await loaded.value.client.listGroups());
  } catch (err) {
    return Result.err(asProviderError(err, loaded.value.row.provider));
  }
}

/**
 * Choose which provider groups may reach private services, and push the
 * matching access policy. Persisting first means a provider hiccup doesn't
 * lose the operator's choice — the policy is re-pushed on the next change or
 * reconcile.
 */
export async function setMeshAccessGroupsHandler(input: {
  organizationId: OrganizationId;
  groupIds: string[];
}): Promise<Result<MeshStatusView, MeshProviderError>> {
  const loaded = await loadMeshClient(input.organizationId);
  if (loaded.isErr()) return Result.err(loaded.error);
  const { row, client } = loaded.value;

  await setMeshAccessGroups({
    organizationId: input.organizationId,
    accessGroupIds: input.groupIds,
  });

  try {
    await client.ensureAccessPolicy({
      name: "otterdeploy-private-services",
      sourceGroupIds: input.groupIds,
      destinationGroupIds: row.nodeGroupId ? [row.nodeGroupId] : [],
      ports: ["443"],
    });
  } catch (err) {
    return Result.err(asProviderError(err, row.provider));
  }

  return Result.ok(
    toStatusView({ ...row, accessGroupIds: input.groupIds }, { strandedPrivateRoutes: 0 }),
  );
}

export interface MeshPeerView extends MeshPeer {
  serverId: string | null;
  orphaned: boolean;
}

/**
 * Peers as the provider sees them, matched to our server rows by mesh address.
 * Drift is REPORTED, never auto-corrected — deleting a peer we merely failed
 * to recognise would be destructive on a mesh the org also uses for its own
 * machines.
 */
export async function listMeshPeers(
  organizationId: OrganizationId,
): Promise<Result<MeshPeerView[], MeshProviderError>> {
  const loaded = await loadMeshClient(organizationId);
  if (loaded.isErr()) return Result.err(loaded.error);

  let peers: MeshPeer[];
  try {
    peers = await loaded.value.client.listPeers();
  } catch (err) {
    return Result.err(asProviderError(err, loaded.value.row.provider));
  }

  const addresses = peers.map((p) => p.ip).filter((ip): ip is string => ip != null);
  const servers = addresses.length
    ? await db
        .select({ id: server.id, meshAddress: server.meshAddress })
        .from(server)
        .where(
          and(eq(server.organizationId, organizationId), inArray(server.meshAddress, addresses)),
        )
    : [];
  const byAddress = new Map(servers.map((s) => [s.meshAddress, s.id]));

  return Result.ok(
    peers.map((peer) => {
      const serverId = peer.ip ? (byAddress.get(peer.ip) ?? null) : null;
      return { ...peer, serverId, orphaned: serverId == null };
    }),
  );
}
