import { oc } from "@orpc/contract";
import { z } from "zod";

export const contract = oc.router({
  health: oc.route({ method: "GET", path: "/health" }).output(
    z.object({
      status: z.literal("ok"),
      timestamp: z.string(),
    })
  ),
});
