/**
 * Docker networks slice of the raw-docker contract: list/inspect/remove plus
 * operator network creation. Split out of contract.ts (250-line cap) the same
 * way the volumes feature splits its schemas.
 */
import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "docker";
const basePath = "/docker";

const serverError = {
  SERVER_ERROR: {
    status: 500,
    message: "Docker error" as const,
  },
};

const notFoundError = {
  NOT_FOUND: {
    status: 404,
    message: "Not found" as const,
  },
};

const conflictError = {
  CONFLICT: {
    status: 409,
    message: "Resource is in use" as const,
  },
};

const networkSchema = z.object({
  id: z.string(),
  name: z.string(),
  driver: z.string(),
  scope: z.string(),
  createdAt: z.number(),
  internal: z.boolean(),
  attachable: z.boolean(),
  /** Swarm routing-mesh network (undeletable plumbing). */
  ingress: z.boolean(),
  /** First IPAM config entry; null when the driver has no subnet (host/null). */
  subnet: z.string().nullable(),
  gateway: z.string().nullable(),
  /** Number of containers attached. */
  containers: z.number(),
  /** Created by an operator through this panel (label otterdeploy.user-network). */
  userNetwork: z.boolean(),
  /** Platform-owned project network (label otterdeploy.managed): never an
   *  attach target for the per-service extra-networks picker. */
  managed: z.boolean(),
});

const networkInspectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string().nullable(),
  driver: z.string(),
  scope: z.string(),
  internal: z.boolean(),
  attachable: z.boolean(),
  ingress: z.boolean(),
  ipv6: z.boolean(),
  subnets: z.array(z.object({ subnet: z.string(), gateway: z.string().nullable() })),
  attachedContainers: z.number(),
});

/** Docker network-name constraint, kept intentionally tighter than the
 *  daemon's (lowercase only) so names read like the platform's own. */
const networkNameField = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]{0,62}$/,
    "Network names must start with a letter or digit and contain only [a-z0-9_-] (max 63 chars)",
  );

/** One IPAM pool. Gateway/ipRange only make sense inside a subnet, so they
 *  require one: the daemon would otherwise reject the create with an opaque
 *  500 instead of a field-level message. */
const ipamPoolSchema = z
  .object({
    subnet: z.string().min(1).optional(),
    gateway: z.string().min(1).optional(),
    ipRange: z.string().min(1).optional(),
  })
  .superRefine((pool, ctx) => {
    if (!pool.subnet && (pool.gateway || pool.ipRange)) {
      ctx.addIssue({
        code: "custom",
        message: "gateway/ipRange require a subnet",
        path: ["subnet"],
      });
    }
  });

export const createNetworkInput = z.object({
  name: networkNameField,
  /** bridge = plain-docker containers; overlay = swarm services. The dialog
   *  defaults to whichever matches the active runtime. */
  driver: z.enum(["bridge", "overlay"]),
  /** No outbound route: containers on the network only see each other. */
  internal: z.boolean().optional(),
  /** Standalone containers may join. Defaults ON: an unattachable network
   *  can't serve the per-service extra-networks feature at all. */
  attachable: z.boolean().default(true),
  enableIPv6: z.boolean().optional(),
  /** Driver MTU (com.docker.network.driver.mtu). 68 is the IPv4 minimum. */
  mtu: z.number().int().min(68).max(65535).optional(),
  ipam: z.array(ipamPoolSchema).optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

const createdNetworkSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Daemon warning (e.g. overlapping subnet advisories), surfaced verbatim. */
  warning: z.string().nullable(),
});

const idInput = z.object({ id: z.string().min(1) });

export const networksContract = {
  list: oc
    .errors(serverError)
    .meta({ path: `${basePath}/networks`, tag, method: "GET" })
    .input(z.object({}))
    .output(z.array(networkSchema)),
  inspect: oc
    .errors({ ...serverError, ...notFoundError })
    .meta({ path: `${basePath}/networks/inspect`, tag, method: "GET" })
    .input(idInput)
    .output(networkInspectSchema),
  create: oc
    .errors({
      ...serverError,
      CONFLICT: {
        status: 409,
        message: "A network with that name already exists" as const,
      },
    })
    .meta({ path: `${basePath}/networks`, tag, method: "POST" })
    .input(createNetworkInput)
    .output(createdNetworkSchema),
  remove: oc
    .errors({ ...serverError, ...notFoundError, ...conflictError })
    .meta({ path: `${basePath}/networks/remove`, tag, method: "POST" })
    .input(idInput)
    .output(z.object({ removed: z.boolean() })),
};
