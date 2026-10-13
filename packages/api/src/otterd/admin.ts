/**
 * Enrollment and the install-admin API of the otterd control plane.
 *
 *   POST /api/otterd/enroll                 a node's signed enrollment request (the token inside is the credential)
 *   POST /admin/enroll-tokens               mint a single-use token
 *   PUT  /admin/services                    create or update a service (normalized and validated)
 *   POST /admin/services/:id/pause|resume
 *   PUT  /admin/nodes/:id/admin             cordon, drain, activate, retire
 *   PUT  /admin/nodes/:id/fence             fence adapter, machine binding, enabled (shows blast radius in the UI)
 *   POST /admin/nodes/:id/manual-fence      an operator's verified out-of-band fence record
 *   POST /admin/nodes/:id/reenroll          a fenced node rejoins at a new epoch
 *   POST /admin/upgrades                    queue nodes for a rolling otterd upgrade to a signed release
 *   GET  /admin/state                       snapshot and the latest decisions
 *
 * Every /admin route needs the bearer token; comparison is constant-time.
 */
import { db } from "@otterdeploy/db";
import { otterdDecision } from "@otterdeploy/db/schema/otterd";
import { fenceEvidence, machineBinding } from "@otterdeploy/otterd-cp";
import { normalizeServiceSpec, serviceSpecInput, signedEnvelope } from "@otterdeploy/otterd-proto";
import { timingSafeEqual } from "@otterdeploy/shared/crypto";
import { Result } from "better-result";
import { desc } from "drizzle-orm";
import * as z from "zod";

import { type RegistryConfig, createEnrollToken, enroll } from "./registry";
import { beginFence, finishFence } from "./store/evidence";
import { queueUpgrade, setAdmin, setFence } from "./store/nodes";
import { beginReenroll } from "./store/reenroll";
import { putService, setPaused } from "./store/services";
import { loadSnapshot } from "./store/snapshot";

export interface AdminConfig {
  token: string;
  now: () => number;
  registry: RegistryConfig;
  wake: () => void;
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

function outcome<T>(r: Result<T, { message: string }>, wake?: () => void): Response {
  if (r.isErr()) return json({ error: r.error.message }, 409);
  wake?.();
  return json({ ok: true, value: r.value });
}

const bodies = {
  token: z.object({
    roles: z.array(z.string()).default(["worker"]),
    labels: z.record(z.string(), z.string()).default({}),
    ttlMs: z
      .number()
      .int()
      .positive()
      .default(15 * 60_000),
  }),
  admin: z.object({ state: z.enum(["active", "cordoned", "draining", "retired"]) }),
  fence: z.object({
    adapter: z.enum(["hetzner", "manual"]),
    binding: machineBinding,
    enabled: z.boolean(),
  }),
  upgrades: z.object({ nodes: z.array(z.string()).min(1), release: signedEnvelope }),
  enroll: z.object({ request: signedEnvelope }),
};

async function body<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<Result<T, { message: string }>> {
  const raw = await Result.tryPromise({
    try: (): Promise<unknown> => req.json(),
    catch: () => ({ message: "invalid JSON" }),
  });
  if (raw.isErr()) return Result.err(raw.error);
  const parsed = schema.safeParse(raw.value);
  return parsed.success ? Result.ok(parsed.data) : Result.err({ message: parsed.error.message });
}

type Handler = (req: Request, id: string, cfg: AdminConfig) => Promise<Response>;

const by = "install-admin";

const routes: Record<string, Handler> = {
  "POST /admin/enroll-tokens": async (req, _, cfg) => {
    const b = await body(req, bodies.token);
    if (b.isErr()) return json({ error: b.error.message }, 400);
    return outcome(await createEnrollToken({ ...b.value, by }, cfg.now()));
  },
  "PUT /admin/services": async (req, _, cfg) => {
    const b = await body(req, serviceSpecInput);
    if (b.isErr()) return json({ error: b.error.message }, 400);
    return outcome(await putService(normalizeServiceSpec(b.value), cfg.now()), cfg.wake);
  },
  "POST /admin/services/:id/pause": async (_, id, cfg) =>
    outcome(await setPaused(id, true, cfg.now()), cfg.wake),
  "POST /admin/services/:id/resume": async (_, id, cfg) =>
    outcome(await setPaused(id, false, cfg.now()), cfg.wake),
  "PUT /admin/nodes/:id/admin": async (req, id, cfg) => {
    const b = await body(req, bodies.admin);
    if (b.isErr()) return json({ error: b.error.message }, 400);
    return outcome(await setAdmin(id, b.value.state, cfg.now(), by), cfg.wake);
  },
  "PUT /admin/nodes/:id/fence": async (req, id, cfg) => {
    const b = await body(req, bodies.fence);
    if (b.isErr()) return json({ error: b.error.message }, 400);
    return outcome(await setFence(id, b.value, cfg.now(), by), cfg.wake);
  },
  "POST /admin/nodes/:id/manual-fence": async (req, id, cfg) => {
    const b = await body(req, fenceEvidence);
    if (b.isErr()) return json({ error: b.error.message }, 400);
    if (b.value.method !== "manual-fence")
      return json({ error: "only a manual fence record is accepted here" }, 400);
    const begun = await beginFence(id, cfg.now(), "operator-supplied manual fence");
    if (begun.isErr()) return outcome(begun);
    return outcome(await finishFence(begun.value.id, { evidence: b.value }, cfg.now()), cfg.wake);
  },
  "POST /admin/nodes/:id/reenroll": async (_, id, cfg) =>
    outcome(await beginReenroll(cfg.registry, id, cfg.now()), cfg.wake),
  "POST /admin/upgrades": async (req, _, cfg) => {
    const b = await body(req, bodies.upgrades);
    if (b.isErr()) return json({ error: b.error.message }, 400);
    if (b.value.release.context !== "otterd/release-manifest/v1") {
      return json({ error: "release must be a signed otterd release manifest" }, 400);
    }
    return outcome(await queueUpgrade(b.value.nodes, b.value.release, cfg.now(), by), cfg.wake);
  },
  "GET /admin/state": async (_, __, cfg) => {
    const snap = await loadSnapshot(cfg.now());
    const decisions = await Result.tryPromise({
      try: () => db.select().from(otterdDecision).orderBy(desc(otterdDecision.id)).limit(200),
      catch: (e) => ({ message: String(e) }),
    });
    if (snap.isErr()) return outcome(snap);
    return json({ snapshot: snap.value, decisions: decisions.unwrapOr([]) });
  },
};

function match(method: string, path: string): { handler: Handler; id: string } | null {
  const parts = path.split("/");
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(" ");
    if (m !== method || !pattern) continue;
    const want = pattern.split("/");
    if (want.length !== parts.length) continue;
    let id = "";
    const ok = want.every((w, i) => {
      if (w === ":id") {
        id = decodeURIComponent(parts[i] ?? "");
        return id.length > 0;
      }
      return w === parts[i];
    });
    if (ok) return { handler, id };
  }
  return null;
}

export function adminRoutes(cfg: AdminConfig): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/api/otterd/enroll") {
      const b = await body(req, bodies.enroll);
      if (b.isErr()) return json({ error: b.error.message }, 400);
      return outcome(await enroll(cfg.registry, b.value.request, cfg.now()), cfg.wake);
    }
    const auth = req.headers.get("authorization") ?? "";
    if (!timingSafeEqual(auth, `Bearer ${cfg.token}`)) return json({ error: "unauthorized" }, 401);
    const m = match(req.method, url.pathname);
    return m ? m.handler(req, m.id, cfg) : json({ error: "not found" }, 404);
  };
}
