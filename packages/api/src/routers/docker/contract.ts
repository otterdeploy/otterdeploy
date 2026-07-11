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

const containerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  /** Entrypoint + args as docker reports them, e.g. "node server.js". */
  command: z.string(),
  state: z.string(),
  status: z.string(),
  /** Human port strings, e.g. "3000/tcp" or "0.0.0.0:8080→80/tcp". */
  ports: z.array(z.string()),
  createdAt: z.number(),
});

const imageSchema = z.object({
  id: z.string(),
  repoTags: z.array(z.string()),
  size: z.number(),
  createdAt: z.number(),
  /** Number of containers using this image. */
  containers: z.number(),
});

const volumeSchema = z.object({
  name: z.string(),
  driver: z.string(),
  mountpoint: z.string(),
  scope: z.string(),
  createdAt: z.number().nullable(),
  /** Bytes on disk; -1 when the daemon doesn't report usage. */
  size: z.number(),
  /** Containers referencing this volume; -1 when unknown. */
  refCount: z.number(),
});

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
});

const taskSchema = z.object({
  id: z.string(),
  serviceId: z.string(),
  slot: z.number().nullable(),
  nodeId: z.string(),
  desiredState: z.string(),
  state: z.string(),
  message: z.string().nullable(),
  /** Image ref from the task's container spec. */
  image: z.string().nullable(),
  createdAt: z.string().nullable(),
});

const nodeSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  role: z.string(),
  availability: z.string(),
  /** Node status.state — "ready", "down", … */
  state: z.string(),
  addr: z.string().nullable(),
  /** True on the current swarm leader. */
  leader: z.boolean(),
});

const logLineSchema = z.object({
  stream: z.enum(["stdout", "stderr"]),
  line: z.string(),
  /** ISO timestamp docker prepends; null if unparseable. */
  ts: z.string().nullable(),
});

const listContainersInput = z.object({
  all: z.boolean().optional(),
});

const listImagesInput = z.object({
  all: z.boolean().optional(),
});

const idInput = z.object({ id: z.string().min(1) });

export const dockerContract = {
  containers: {
    list: oc
      .errors(serverError)
      .meta({ path: `${basePath}/containers`, tag, method: "GET" })
      .input(listContainersInput)
      .output(z.array(containerSchema)),
    inspect: oc
      .errors({ ...serverError, ...notFoundError })
      .meta({ path: `${basePath}/containers/inspect`, tag, method: "GET" })
      .input(idInput)
      .output(z.unknown()),
    logs: oc
      .errors({ ...serverError, ...notFoundError })
      .meta({ path: `${basePath}/containers/logs`, tag, method: "GET" })
      .input(
        z.object({
          id: z.string().min(1),
          /** Last N lines (no follow). Clamped server-side. */
          tail: z.number().int().min(1).max(1000).optional(),
        }),
      )
      .output(z.object({ lines: z.array(logLineSchema) })),
  },
  images: {
    list: oc
      .errors(serverError)
      .meta({ path: `${basePath}/images`, tag, method: "GET" })
      .input(listImagesInput)
      .output(z.array(imageSchema)),
    inspect: oc
      .errors({ ...serverError, ...notFoundError })
      .meta({ path: `${basePath}/images/inspect`, tag, method: "GET" })
      .input(idInput)
      .output(z.unknown()),
    remove: oc
      .errors({ ...serverError, ...notFoundError, ...conflictError })
      .meta({ path: `${basePath}/images/remove`, tag, method: "POST" })
      .input(z.object({ id: z.string().min(1), force: z.boolean().optional() }))
      .output(z.object({ deleted: z.number(), untagged: z.number() })),
    prune: oc
      .errors(serverError)
      .meta({ path: `${basePath}/images/prune`, tag, method: "POST" })
      // Dangling-only by design — pruning tagged-but-unused images from the
      // debug page would eat the deploy cache.
      .input(z.object({}))
      .output(z.object({ imagesDeleted: z.number(), reclaimedBytes: z.number() })),
  },
  volumes: {
    list: oc
      .errors(serverError)
      .meta({ path: `${basePath}/volumes`, tag, method: "GET" })
      .input(z.object({}))
      .output(z.array(volumeSchema)),
    inspect: oc
      .errors({ ...serverError, ...notFoundError })
      .meta({ path: `${basePath}/volumes/inspect`, tag, method: "GET" })
      .input(z.object({ name: z.string().min(1) }))
      .output(z.unknown()),
    remove: oc
      .errors({ ...serverError, ...notFoundError, ...conflictError })
      .meta({ path: `${basePath}/volumes/remove`, tag, method: "POST" })
      .input(z.object({ name: z.string().min(1) }))
      .output(z.object({ removed: z.boolean() })),
  },
  networks: {
    list: oc
      .errors(serverError)
      .meta({ path: `${basePath}/networks`, tag, method: "GET" })
      .input(z.object({}))
      .output(z.array(networkSchema)),
    inspect: oc
      .errors({ ...serverError, ...notFoundError })
      .meta({ path: `${basePath}/networks/inspect`, tag, method: "GET" })
      .input(idInput)
      .output(z.unknown()),
    remove: oc
      .errors({ ...serverError, ...notFoundError, ...conflictError })
      .meta({ path: `${basePath}/networks/remove`, tag, method: "POST" })
      .input(idInput)
      .output(z.object({ removed: z.boolean() })),
  },
  tasks: {
    list: oc
      .errors(serverError)
      .meta({ path: `${basePath}/tasks`, tag, method: "GET" })
      .input(z.object({}))
      .output(z.array(taskSchema)),
  },
  nodes: {
    list: oc
      .errors(serverError)
      .meta({ path: `${basePath}/nodes`, tag, method: "GET" })
      .input(z.object({}))
      // `swarm:false` under the plain-docker runtime — the UI uses it to
      // decide whether a node selector makes sense at all.
      .output(z.object({ swarm: z.boolean(), nodes: z.array(nodeSchema) })),
  },
};
