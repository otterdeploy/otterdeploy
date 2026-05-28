/**
 * Tiny zod-backed param validator middleware for Hono — saves pulling in
 * @hono/zod-validator just for path params.
 *
 *   app.get(
 *     "/sse/projects/:projectId/events",
 *     validateParams(z.object({ projectId: zId(ID_PREFIX.project) })),
 *     handler,
 *   );
 *
 * On success, the typed object is stashed as `c.var.params` so the
 * handler can read `c.var.params.projectId` with the right branded type.
 * On failure, returns 400 with the zod error messages.
 */

import type { MiddlewareHandler } from "hono";
import * as z from "zod";

export interface ValidatedVariables<T> {
  params: T;
}

export function validateParams<T extends z.ZodTypeAny>(
  schema: T,
): MiddlewareHandler<{ Variables: ValidatedVariables<z.output<T>> }> {
  return async (c, next) => {
    const parsed = schema.safeParse(c.req.param());
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid request parameters",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      );
    }
    c.set("params", parsed.data as z.output<T>);
    await next();
  };
}
