import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "docker";
const basePath = "/docker";

export const containerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  createdAt: z.number(),
});

export const listContainersInput = z.object({
  all: z.boolean().optional(),
});

export const dockerContract = {
  containers: {
    list: oc
      .errors({
        SERVER_ERROR: {
          status: 500,
          message: "Docker error" as const,
        },
      })
      .meta({
        path: `${basePath}/containers`,
        tag,
        method: "GET",
      })
      .input(listContainersInput)
      .output(z.array(containerSchema)),
  },
};
