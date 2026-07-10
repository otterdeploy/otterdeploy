/**
 * Volumes oRPC contract — org-scoped inventory of the daemon's named volumes,
 * enriched with the platform resource each volume belongs to (databases claim
 * volumes by naming convention, services via `service_mount` rows, compose
 * stacks via the swarm stack-namespace prefix) plus orphan detection.
 *
 * Sizes are the daemon's *measured* bytes from `docker system df -v`
 * (`UsageData.Size`) — the `local` driver has no provisioned/quota size, so
 * none is invented here.
 */
import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "volumes";
const basePath = "/volumes";

const serverError = {
  SERVER_ERROR: {
    status: 500,
    message: "Docker error" as const,
  },
};

const notFound = {
  NOT_FOUND: {
    status: 404,
    message: "Volume not found" as const,
  },
};

/** Docker's volume-name constraint (RestrictedNamePattern). */
export const volumeNameField = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    "Volume names must start with a letter or digit and contain only [a-zA-Z0-9_.-]",
  );

/** One platform resource a volume is attached to / claimed by. */
export const volumeAttachmentSchema = z.object({
  resourceId: z.string(),
  resourceName: z.string(),
  resourceType: z.enum(["database", "service", "compose"]),
  projectId: z.string(),
  projectSlug: z.string(),
  /** Database engine when the owner is a database resource. */
  engine: z.string().nullable(),
  /** `container` = a live container mount carried the resource label;
   *  `claim` = matched by the provisioner's naming convention / mount row. */
  via: z.enum(["container", "claim"]),
});

export const volumeSchema = z.object({
  name: z.string(),
  driver: z.string(),
  mountpoint: z.string(),
  scope: z.string(),
  createdAt: z.number().nullable(),
  labels: z.record(z.string(), z.string()),
  /** Measured bytes on disk from `system df`; -1 when the daemon doesn't report usage. */
  sizeBytes: z.number(),
  /** Containers (any state) whose mounts reference this volume. */
  refCount: z.number(),
  /** Names of the containers mounting the volume (in-use guard copy). */
  containerNames: z.array(z.string()),
  /** Platform resources this volume belongs to (deduped by resource). */
  attachedTo: z.array(volumeAttachmentSchema),
  /** Unreferenced by any container AND unclaimed by any platform resource. */
  orphan: z.boolean(),
});

const listOutput = z.object({
  /** Daemon identity, when `system info` is reachable. */
  node: z
    .object({
      name: z.string(),
      serverVersion: z.string(),
    })
    .nullable(),
  /** Volume drivers the daemon reports as installed (plugin list). */
  drivers: z.array(z.string()),
  volumes: z.array(volumeSchema),
});

const createVolumeInput = z.object({
  name: volumeNameField,
  driver: z.string().min(1).default("local"),
  labels: z.record(z.string(), z.string()).optional(),
});

/** Create returns the daemon's view of the new volume (no enrichment yet). */
const createdVolumeSchema = z.object({
  name: z.string(),
  driver: z.string(),
  mountpoint: z.string(),
  createdAt: z.number().nullable(),
  labels: z.record(z.string(), z.string()),
});

const nameInput = z.object({ name: volumeNameField });

export const volumesContract = {
  list: oc
    .errors(serverError)
    .meta({ path: basePath, tag, method: "GET" })
    .input(z.object({}))
    .output(listOutput),

  inspect: oc
    .errors({ ...serverError, ...notFound })
    .meta({ path: `${basePath}/{name}`, tag, method: "GET" })
    .input(nameInput)
    .output(z.object({ raw: z.record(z.string(), z.unknown()) })),

  create: oc
    .errors({
      ...serverError,
      CONFLICT: {
        status: 409,
        message: "A volume with that name already exists" as const,
      },
    })
    .meta({ path: basePath, tag, method: "POST" })
    .input(createVolumeInput)
    .output(createdVolumeSchema),

  remove: oc
    .errors({
      ...serverError,
      ...notFound,
      IN_USE: {
        status: 409,
        message: "Volume is in use" as const,
        data: z.object({ reason: z.string() }),
      },
    })
    .meta({ path: `${basePath}/{name}`, tag, method: "DELETE" })
    .input(nameInput)
    .output(z.object({ ok: z.boolean() })),
};
