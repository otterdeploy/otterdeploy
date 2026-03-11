import { oc } from "@orpc/contract";
import * as z from "zod";

export const contract = oc.router({
  health: oc.route({ method: "GET", path: "/health" }).output(
    z.object({
      status: z.literal("ok"),
      timestamp: z.number(),
    }),
  ),
  // auth: oc.router({
  //   signup: oc
  //     .route({ method: "POST", path: "/auth/signup" })
  //     .input(z.object({ email: z.string(), password: z.string() }))
  //     .output(z.object({ token: z.string() })),
  //   signin: oc
  //     .route({ method: "POST", path: "/auth/signin" })
  //     .input(z.object({ email: z.string(), password: z.string() }))
  //     .output(z.object({ token: z.string() })),
  //   me: oc
  //     .route({ method: "GET", path: "/auth/me" })
  //     .output(z.object({ email: z.string(), name: z.string() })),
  // }),
});
