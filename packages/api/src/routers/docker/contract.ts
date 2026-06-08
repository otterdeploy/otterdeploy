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

export const containerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  createdAt: z.number(),
});

export const imageSchema = z.object({
  id: z.string(),
  repoTags: z.array(z.string()),
  size: z.number(),
  createdAt: z.number(),
  /** Number of containers using this image. */
  containers: z.number(),
});

export const volumeSchema = z.object({
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

export const networkSchema = z.object({
  id: z.string(),
  name: z.string(),
  driver: z.string(),
  scope: z.string(),
  createdAt: z.number(),
  internal: z.boolean(),
  attachable: z.boolean(),
  /** Number of containers attached. */
  containers: z.number(),
});

export const taskSchema = z.object({
  id: z.string(),
  serviceId: z.string(),
  slot: z.number().nullable(),
  nodeId: z.string(),
  desiredState: z.string(),
  state: z.string(),
  message: z.string().nullable(),
  createdAt: z.string().nullable(),
});

export const listContainersInput = z.object({
  all: z.boolean().optional(),
});

export const listImagesInput = z.object({
  all: z.boolean().optional(),
});

export const dockerContract = {
  containers: {
    list: oc
      .errors(serverError)
      .meta({ path: `${basePath}/containers`, tag, method: "GET" })
      .input(listContainersInput)
      .output(z.array(containerSchema)),
  },
  images: {
    list: oc
      .errors(serverError)
      .meta({ path: `${basePath}/images`, tag, method: "GET" })
      .input(listImagesInput)
      .output(z.array(imageSchema)),
  },
  volumes: {
    list: oc
      .errors(serverError)
      .meta({ path: `${basePath}/volumes`, tag, method: "GET" })
      .input(z.object({}))
      .output(z.array(volumeSchema)),
  },
  networks: {
    list: oc
      .errors(serverError)
      .meta({ path: `${basePath}/networks`, tag, method: "GET" })
      .input(z.object({}))
      .output(z.array(networkSchema)),
  },
  tasks: {
    list: oc
      .errors(serverError)
      .meta({ path: `${basePath}/tasks`, tag, method: "GET" })
      .input(z.object({}))
      .output(z.array(taskSchema)),
  },
};
