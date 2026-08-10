/**
 * Private networking oRPC contract: connect / inspect / disconnect the org's
 * own VPN account (NetBird now, Tailscale behind the same shapes).
 *
 * The stored credential is NEVER part of any output schema. `status` is safe
 * for any org member to read (the service exposure control needs to know a
 * mesh exists); mutations are gated admin/owner in the router.
 *
 * Design: docs/designs/vpn-mesh.md
 */
import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "mesh";
const basePath = "/mesh";

const meshProviderSchema = z.enum(["netbird", "tailscale"]);
const meshStatusSchema = z.enum(["connected", "error", "disconnected"]);

const meshGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  peerCount: z.number().int(),
});

const meshPeerSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostname: z.string().nullable(),
  ip: z.string().nullable(),
  dnsLabel: z.string().nullable(),
  connected: z.boolean(),
  lastSeen: z.date().nullable(),
  /** Set when this peer matches a known otterdeploy server row. */
  serverId: z.string().nullable(),
  /** Registered on the provider but not matched to any server we manage. */
  orphaned: z.boolean(),
});

/**
 * The org's mesh, or `connected: false` when there is none. A null connection
 * is the normal, fully-supported state (the whole feature is optional) so
 * this is an absence, not an error.
 */
const meshStatusOutput = z.object({
  connected: z.boolean(),
  provider: meshProviderSchema.nullable(),
  status: meshStatusSchema.nullable(),
  managementUrl: z.string().nullable(),
  /** True when `managementUrl` is not the hosted service. */
  selfHosted: z.boolean(),
  accountLabel: z.string().nullable(),
  /** DNS zone private hostnames are minted under. */
  peerDomain: z.string().nullable(),
  /** Whether peerDomain was read from the account, observed on a peer, or
   *  assumed. Surfaced so operators can spot a wrong guess before it breaks
   *  hostnames. */
  peerDomainSource: z.enum(["account-settings", "peer-dns-label", "default"]).nullable(),
  dnsLabel: z.string().nullable(),
  /** Example of the hostname shape a private service would get. */
  privateHostExample: z.string().nullable(),
  accessGroupIds: z.array(z.string()),
  lastVerifiedAt: z.date().nullable(),
  lastError: z.string().nullable(),
  peerCount: z.number().int().nullable(),
  /** Number of routes still marked private while the mesh isn't usable. These
   *  are NOT publicly reachable and NOT silently re-exposed. The UI turns
   *  this into an explicit "make public" decision for the operator. */
  strandedPrivateRoutes: z.number().int(),
});

const connectInput = z.object({
  provider: meshProviderSchema.default("netbird"),
  /** Blank ⇒ hosted NetBird. Any other value is treated as self-hosted. */
  managementUrl: z.string().trim().max(2048).optional(),
  /** NetBird personal access token / Tailscale OAuth client secret. */
  apiToken: z.string().min(1).max(4096),
  /** Tailscale only: a PAT has no public half. */
  oauthClientId: z.string().trim().max(512).optional(),
  /**
   * Wildcard DNS label the nodes register. Lowercase DNS label; defaults to
   * "od". Changing it after nodes have joined requires re-enrolling them,
   * which the UI warns about.
   */
  dnsLabel: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/, "must be a single lowercase DNS label")
    .default("od"),
});

const setAccessGroupsInput = z.object({
  /** Provider groups permitted to reach private services. An empty list is
   *  valid and means "nobody yet". We never invent access on the org's
   *  behalf. */
  groupIds: z.array(z.string()).max(64),
});

const emptyInput = z.object({}).optional();

/**
 * Provider failures are split by cause because the operator's next action
 * differs completely: a 401 means "re-authenticate", an unreachable
 * self-hosted management server means "check the URL/network", and neither
 * should be reported as the other.
 */
const providerErrors = {
  NOT_CONNECTED: {
    status: 409,
    message: "No private network is connected for this organization" as const,
  },
  PROVIDER_UNAUTHORIZED: {
    status: 401,
    message: "The VPN provider rejected the stored credential" as const,
  },
  PROVIDER_UNREACHABLE: {
    status: 502,
    message: "Could not reach the VPN provider" as const,
  },
} as const;

export const meshContract = {
  status: oc
    .route({ method: "GET", path: `${basePath}/status`, tags: [tag] })
    .input(emptyInput)
    .output(meshStatusOutput),

  connect: oc
    .errors(providerErrors)
    .route({ method: "POST", path: `${basePath}/connect`, tags: [tag] })
    .input(connectInput)
    .output(meshStatusOutput),

  /** Re-run whoami against the stored credential and record the outcome. */
  verify: oc
    .errors(providerErrors)
    .route({ method: "POST", path: `${basePath}/verify`, tags: [tag] })
    .input(emptyInput)
    .output(meshStatusOutput),

  /** Never fails: disconnecting something that isn't connected is a no-op. */
  disconnect: oc
    .route({ method: "POST", path: `${basePath}/disconnect`, tags: [tag] })
    .input(emptyInput)
    .output(meshStatusOutput),

  /** Provider groups, for choosing who may reach private services. */
  listGroups: oc
    .errors(providerErrors)
    .route({ method: "GET", path: `${basePath}/groups`, tags: [tag] })
    .input(emptyInput)
    .output(z.array(meshGroupSchema)),

  setAccessGroups: oc
    .errors(providerErrors)
    .route({ method: "POST", path: `${basePath}/access-groups`, tags: [tag] })
    .input(setAccessGroupsInput)
    .output(meshStatusOutput),

  /** Peers as the provider sees them, matched against our server rows. Drift
   *  is reported, never auto-corrected. */
  listPeers: oc
    .errors(providerErrors)
    .route({ method: "GET", path: `${basePath}/peers`, tags: [tag] })
    .input(emptyInput)
    .output(z.array(meshPeerSchema)),
};
