import type { OrganizationId } from "@otterdeploy/shared/id";
import type { Context } from "hono";

/**
 * POST /api/agent/register — od-5j8.20. The bootstrap-authenticated call an
 * agent process makes once at startup (and again on a rolling schedule
 * before its current session credential expires — see health-agent.ts) to
 * obtain a per-node session credential. Auth is the bootstrap Bearer minted
 * into the GLOBAL agent service's Env (agent-service.ts); the response is a
 * fresh, short-lived, hostname-bound credential for `/api/agent/health`.
 *
 * Matching reuses agent-ingest.ts's hostname lookup (server.hostname OR
 * server.name), across all orgs — same "one bootstrap row per org" caveat
 * that comment documents. An unmatched hostname is a 404: register the
 * server in the UI first, same as the old ingest route's 202-unmatched
 * semantics but expressed as a hard failure here because there is nothing
 * useful to persist without a serverId to bind the credential to.
 */
import { log } from "evlog";
import * as z from "zod";

import { issueSessionCredential } from "./agent-credential";
import { matchServersByHostname } from "./agent-ingest";
import { verifyBootstrapToken } from "./agent-token";

const registerSchema = z.object({ hostname: z.string().min(1) });

export async function agentRegisterHandler(c: Context): Promise<Response> {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token || !(await verifyBootstrapToken(token))) {
    return c.json({ error: "invalid bootstrap token" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid register shape" }, 400);

  const rows = await matchServersByHostname(parsed.data.hostname);
  if (rows.length === 0) {
    log.warn({ healthAgent: { event: "register-unmatched", hostname: parsed.data.hostname } });
    return c.json(
      { error: "no server registered with this hostname yet — add it in the UI first" },
      404,
    );
  }
  // Deterministic pick when a hostname matches more than one org's row (the
  // bootstrap-localhost convention creates one such row per org for
  // "127.0.0.1"; real remote swarm nodes essentially never collide) — the
  // oldest row wins, same as any other "first registration is authoritative"
  // tie-break in this codebase.
  const [row] = rows;
  if (!row) return c.json({ error: "no server registered with this hostname yet" }, 404);

  const issued = await issueSessionCredential({
    serverId: row.id,
    // server.organizationId carries no branded $type at the schema level
    // (same as every other server-row consumer in this codebase); the value
    // itself is a real organization id, just not compile-time-branded here.
    organizationId: row.organizationId as OrganizationId,
    hostname: parsed.data.hostname,
  });
  return c.json({ credential: issued.credential, expiresAt: issued.expiresAt.toISOString() });
}
