import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "env";
const basePath = "/env";

const envSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

export const envContract = {
  get: oc
    .errors({
      NOT_FOUND: {
        message: "Environment not found" as const,
      },
    })
    .meta({ path: `${basePath}/{id}`, tag, method: "GET" })
    .input(z.object({ id: z.string() }))
    .output(envSchema),
  list: oc.meta({ path: basePath, tag, method: "GET" }).output(z.array(envSchema)),
  create: oc
    .meta({ path: `${basePath}/create`, tag, method: "POST" })
    .errors({
      CONFLICT: {
        message: "Environment already exists" as const,
      },
    })
    .input(envSchema)
    .output(envSchema),
};
