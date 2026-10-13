/**
 * The migration admin API: moving this install's plain-Docker workloads onto
 * otterd, one resource at a time, without restarting them. Served by the
 * server because the migration's host steps need the Docker daemon the
 * legacy runtime uses. Bearer-guarded with the otterd control plane's admin
 * token; with no token configured the API does not exist.
 *
 *   GET  /api/otterd/migration/preflight              read-only inventory and blockers
 *   POST /api/otterd/migration/session                open the session (idempotent)
 *   POST /api/otterd/migration/resources/:id/migrate  adopt one resource in place
 *   POST /api/otterd/migration/resources/:id/rollback give it back to the legacy runtime
 *   POST /api/otterd/migration/finalize               when nothing is left on the legacy runtime
 *   GET  /api/otterd/migration/state                  the session and every resource's step
 */
import type { Result } from "better-result";
import type { Context, Env, Hono } from "hono";

import { createRequestDockerClient } from "@otterdeploy/api/lib/docker-client";
import {
  finalize,
  migrateResource,
  rollbackResource,
} from "@otterdeploy/api/otterd/migration/controller";
import { preflight } from "@otterdeploy/api/otterd/migration/inventory";
import { allRows, currentSession, openSession } from "@otterdeploy/api/otterd/migration/store";
import { Docker } from "@otterdeploy/docker";
import { env } from "@otterdeploy/env/server";
import { timingSafeEqual } from "@otterdeploy/shared/crypto";
import { Temporal } from "@otterdeploy/shared/temporal";

const BY = "install-admin";

function authorized(c: Context): boolean {
  const token = env.OTTERD_CP_ADMIN_TOKEN;
  return (
    token !== undefined && timingSafeEqual(c.req.header("authorization") ?? "", `Bearer ${token}`)
  );
}

function answer(c: Context, r: Result<unknown, unknown>) {
  if (r.isOk()) return c.json({ ok: true, value: r.value });
  const e = r.error;
  return c.json({ error: e instanceof Error ? e.message : String(e) }, 409);
}

export function registerMigrationRoutes<E extends Env>(app: Hono<E>): void {
  const route = (handler: (c: Context) => Promise<Response>) => async (c: Context) => {
    c.header("Cache-Control", "no-store");
    return authorized(c) ? handler(c) : c.json({ error: "not found" }, 404);
  };
  // Inventory reads are bounded; the migrate step waits on the node, so it
  // uses a client without the request timeout.
  const reader = () => createRequestDockerClient();
  const writer = () => new Docker();

  app.get(
    "/api/otterd/migration/preflight",
    route(async (c) => answer(c, await preflight(reader()))),
  );
  app.post(
    "/api/otterd/migration/session",
    route(async (c) => answer(c, await openSession(BY, Temporal.Now.instant().epochMilliseconds))),
  );
  app.post(
    "/api/otterd/migration/resources/:id/migrate",
    route(async (c) => answer(c, await migrateResource(writer(), c.req.param("id") ?? "", BY))),
  );
  app.post(
    "/api/otterd/migration/resources/:id/rollback",
    route(async (c) => answer(c, await rollbackResource(c.req.param("id") ?? ""))),
  );
  app.post(
    "/api/otterd/migration/finalize",
    route(async (c) => answer(c, await finalize(reader()))),
  );
  app.get(
    "/api/otterd/migration/state",
    route(async (c) => {
      const [session, rows] = await Promise.all([currentSession(), allRows()]);
      return c.json({
        session: session.isOk() ? session.value : { error: session.error.message },
        resources: rows.isOk() ? rows.value : { error: rows.error.message },
      });
    }),
  );
}
