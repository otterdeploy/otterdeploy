import { eventIterator, oc } from "@orpc/contract";
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

const containerInspectSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  imageId: z.string().nullable(),
  createdAt: z.string().nullable(),
  platform: z.string().nullable(),
  driver: z.string().nullable(),
  restartCount: z.number(),
  state: z.object({
    status: z.string().nullable(),
    running: z.boolean(),
    paused: z.boolean(),
    restarting: z.boolean(),
    oomKilled: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    health: z.string().nullable(),
    healthFailingStreak: z.number(),
  }),
});

const imageInspectSchema = z.object({
  id: z.string(),
  repoTags: z.array(z.string()),
  repoDigests: z.array(z.string()),
  createdAt: z.string().nullable(),
  architecture: z.string().nullable(),
  os: z.string().nullable(),
  variant: z.string().nullable(),
  size: z.number(),
});

const volumeInspectSchema = z.object({
  name: z.string(),
  driver: z.string(),
  scope: z.string(),
  createdAt: z.string().nullable(),
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

/** Daemon object classes the events feed distinguishes. The normalizer only
 *  types container/service/task/network/node; image and volume come off the
 *  raw payload, and anything else (plugin, config, secret, daemon, future
 *  types) lands in "unknown". */
const dockerEventTypeSchema = z.enum([
  "container",
  "service",
  "task",
  "network",
  "node",
  "image",
  "volume",
  "unknown",
]);

/** One daemon event, flattened for display — no nested Actor, no raw echo. */
const dockerEventSchema = z.object({
  /** Daemon event timestamp, epoch milliseconds. */
  ts: z.number(),
  type: dockerEventTypeSchema,
  /** Daemon action verb — `start`, `die`, `pull`, `connect`, … */
  action: z.string(),
  actorId: z.string(),
  /** Human name when the daemon reports one (container/service/network name,
   *  image ref); null for events that only carry an id. */
  actorName: z.string().nullable(),
  /** Actor attributes as the daemon sent them — labels, exitCode, signal, … */
  attributes: z.record(z.string(), z.string()),
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
      .output(containerInspectSchema),
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
      .output(imageInspectSchema),
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
      .output(volumeInspectSchema),
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
      .output(networkInspectSchema),
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
  events: {
    stream: oc
      .errors(serverError)
      .meta({ path: `${basePath}/events/stream`, tag, method: "GET" })
      // Optional server-side narrowing; the web UI streams everything and
      // filters client-side so toggling a chip never tears the buffer.
      .input(z.object({ types: z.array(dockerEventTypeSchema).optional() }))
      .output(eventIterator(dockerEventSchema)),
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
