/**
 * Volumes oRPC contract: installation-admin inventory of the daemon's named
 * volumes, enriched with the platform resource each volume belongs to.
 *
 * Sizes are the daemon's *measured* bytes from `docker system df -v`
 * (`UsageData.Size`): the `local` driver has no provisioned/quota size, so
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
const volumeAttachmentSchema = z.object({
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
  scope: z.string(),
  createdAt: z.number().nullable(),
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
  createdAt: z.number().nullable(),
});

const nameInput = z.object({ name: volumeNameField });
const inspectedVolumeSchema = z.object({
  name: z.string(),
  driver: z.string(),
  scope: z.string(),
  createdAt: z.string().nullable(),
});

// ─── File explorer (read-only) ─────────────────────────────────────────────

const invalidPath = {
  INVALID_PATH: {
    status: 400,
    message: "Invalid path" as const,
  },
};

/** Path inside the volume, relative to its root ("" = root). Traversal and
 *  shell-metacharacter safety is enforced server-side (explore.ts) — the
 *  contract only bounds the size. */
const explorePathInput = z.object({
  name: volumeNameField,
  path: z.string().max(4096).default(""),
});

const volumeDirEntrySchema = z.object({
  name: z.string(),
  kind: z.enum(["file", "dir", "symlink", "other"]),
  /** stat %s — meaningful for files; directories report their inode size. */
  size: z.number(),
  /** Unix seconds (stat %Y). */
  mtime: z.number(),
  /** Octal permission string (stat %a), e.g. "755". */
  mode: z.string(),
});

/** Flat view of a capped file read: `content` is null when `binary`;
 *  `truncated` means the file is larger than the ~256 KB view cap. */
const volumeFileViewSchema = z.object({
  content: z.string().nullable(),
  binary: z.boolean(),
  truncated: z.boolean(),
  size: z.number(),
});

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
    .output(z.object({ details: inspectedVolumeSchema })),

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

  /** Read-only browse of a volume's contents via a disposable helper
   *  container (see explore.ts). NOT_FOUND covers both a missing volume and
   *  a missing path inside it — the message says which. */
  explore: {
    list: oc
      .errors({ ...serverError, ...notFound, ...invalidPath })
      .meta({ path: `${basePath}/{name}/files`, tag, method: "GET" })
      .input(explorePathInput)
      .output(z.object({ path: z.string(), entries: z.array(volumeDirEntrySchema) })),

    read: oc
      .errors({ ...serverError, ...notFound, ...invalidPath })
      .meta({ path: `${basePath}/{name}/file`, tag, method: "GET" })
      .input(explorePathInput)
      .output(volumeFileViewSchema),
  },
};
