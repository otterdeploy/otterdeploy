/**
 * The otterd control-plane process: the hub nodes dial (wss), the scheduler
 * loop, enrollment and the install-admin API. Started on its own
 * (`bun packages/api/src/otterd/main.ts`); current installs never start it.
 *
 * Configuration (environment):
 *
 *   OTTERD_CP_LISTEN_PORT        TLS port for nodes and the admin API
 *   OTTERD_CP_TLS_CERT / _KEY    PEM files
 *   OTTERD_CP_SIGNING_KEY        file holding the base64 Ed25519 seed (0600)
 *   OTTERD_CP_INSTALL_ID         install id
 *   OTTERD_CP_CONTROL_URL        wss URL written into enrollment certificates
 *   OTTERD_CP_RECOVERY_KEY       recovery root public key (base64)
 *   OTTERD_CP_ADMIN_TOKEN        bearer token for /admin
 *   OTTERD_CP_ORGANIZATION_ID    organization owning node telemetry (optional)
 *   OTTERD_RECOVER_BIN           `otterd-recover` path
 *   OTTERD_ANCHOR_CONFIG / OTTERD_ANCHOR_ENROLLMENT_KEY
 *                                off-node anchor; absent = local-only profile
 *   OTTERD_ANCHOR_ACCESS_KEY / _SECRET_KEY, HCLOUD_TOKEN
 *                                passed only to `otterd-recover`
 */
import { db } from "@otterdeploy/db";
import { otterdAuthority } from "@otterdeploy/db/schema/otterd";
import { seedSigner } from "@otterdeploy/otterd-cp";
import { idSchema } from "@otterdeploy/shared/id";
import { Temporal } from "@otterdeploy/shared/temporal";
import { readFileSync } from "node:fs";
import * as z from "zod";

import { adminRoutes } from "./admin";
import { Controller } from "./controller";
import { type Connection, Hub } from "./hub/hub";
import { Leadership } from "./leader";
import { nodeRow } from "./store/nodes";
import { isFenced } from "./store/reenroll";
import { clearStaleSessions } from "./store/reports";
import { type ToolConfig, anchorEnroll, anchorTerm } from "./tools";

/* oxlint-disable-next-line node/no-process-env -- process boundary: this entry point reads its own configuration */
const env = process.env;

const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    OTTERD_CP_LISTEN_PORT: z.coerce.number().int().positive(),
    OTTERD_CP_TLS_CERT: z.string().min(1),
    OTTERD_CP_TLS_KEY: z.string().min(1),
    OTTERD_CP_SIGNING_KEY: z.string().min(1),
    OTTERD_CP_INSTALL_ID: z.string().min(1),
    OTTERD_CP_CONTROL_URL: z.url(),
    OTTERD_CP_RECOVERY_KEY: z.string().min(1),
    OTTERD_CP_ADMIN_TOKEN: z.string().min(32),
    OTTERD_CP_ORGANIZATION_ID: z.string().optional(),
    OTTERD_RECOVER_BIN: z.string().default("/usr/local/bin/otterd-recover"),
    OTTERD_ANCHOR_CONFIG: z.string().optional(),
    OTTERD_ANCHOR_ENROLLMENT_KEY: z.string().optional(),
  })
  .parse(env);

const now = (): number => Temporal.Now.instant().epochMilliseconds;
const seed = Buffer.from(readFileSync(config.OTTERD_CP_SIGNING_KEY, "utf8").trim(), "base64");
const signer = seedSigner(new Uint8Array(seed));
const passEnv = ["OTTERD_ANCHOR_ACCESS_KEY", "OTTERD_ANCHOR_SECRET_KEY", "HCLOUD_TOKEN", "PATH"];
const tools: ToolConfig = {
  binary: config.OTTERD_RECOVER_BIN,
  ...(config.OTTERD_ANCHOR_CONFIG ? { anchorConfig: config.OTTERD_ANCHOR_CONFIG } : {}),
  ...(config.OTTERD_ANCHOR_ENROLLMENT_KEY
    ? { enrollmentKey: config.OTTERD_ANCHOR_ENROLLMENT_KEY }
    : {}),
  env: Object.fromEntries(passEnv.flatMap((k) => (env[k] ? [[k, env[k]]] : []))),
};
const anchored = tools.anchorConfig !== undefined;

/** The issuing term: the anchor's when one is configured, else 1 (local-only). */
async function authority(): Promise<number> {
  const term = anchored ? (await anchorTerm(tools)).unwrap().recoveryTerm : 1;
  await db
    .insert(otterdAuthority)
    .values({ installId: config.OTTERD_CP_INSTALL_ID, authorityTerm: term, updatedAt: now() })
    .onConflictDoUpdate({
      target: otterdAuthority.installId,
      set: { authorityTerm: term, updatedAt: now() },
    });
  return term;
}

const term = await authority();
let issueCheckedAt = 0;
let issueAllowed = true;
/** Issue only while the anchor is active at our term (re-read every 30 s). */
async function mayIssue(): Promise<boolean> {
  if (!anchored || now() - issueCheckedAt < 30_000) return issueAllowed;
  issueCheckedAt = now();
  const t = await anchorTerm(tools);
  issueAllowed = t.isOk() && t.value.phase === "active" && t.value.recoveryTerm === term;
  return issueAllowed;
}

await clearStaleSessions(now());
const organization = idSchema.organization.safeParse(config.OTTERD_CP_ORGANIZATION_ID);
let controller: Controller | null = null;
const hub = new Hub({
  installId: config.OTTERD_CP_INSTALL_ID,
  signer,
  authorityTerm: () => term,
  findNode: async (nodeId) => {
    const found = await nodeRow(nodeId);
    const row = found.isOk() ? found.value : null;
    // An unreadable fence record counts as fenced: refuse rather than guess.
    const fenced = row ? (await isFenced(row.nodeId, row.nodeEpoch)).unwrapOr(true) : false;
    return row
      ? {
          nodeId: row.nodeId,
          nodeEpoch: row.nodeEpoch,
          identityKey: row.identityKey,
          identityKeyId: row.identityKeyId,
          retired: row.admin === "retired",
          recoveryEpoch: row.recoveryEpoch,
          fenced,
        }
      : null;
  },
  organizationId: organization.success ? organization.data : null,
  now,
  wake: () => controller?.wake(),
});
const leadership = new Leadership(config.DATABASE_URL);
controller = new Controller({
  hub,
  tools,
  now,
  mayIssue,
  leader: () => leadership.check(),
  adoption: true,
});

const admin = adminRoutes({
  token: config.OTTERD_CP_ADMIN_TOKEN,
  now,
  registry: {
    signer,
    controlUrl: config.OTTERD_CP_CONTROL_URL,
    recoveryKey: config.OTTERD_CP_RECOVERY_KEY,
    anchor: anchored ? (node) => anchorEnroll(tools, node) : null,
  },
  wake: () => controller?.wake(),
});

Bun.serve<{ conn: Connection | null }>({
  port: config.OTTERD_CP_LISTEN_PORT,
  tls: { cert: Bun.file(config.OTTERD_CP_TLS_CERT), key: Bun.file(config.OTTERD_CP_TLS_KEY) },
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/api/otterd/connect") {
      return server.upgrade(req, { data: { conn: null } })
        ? undefined
        : new Response("upgrade required", { status: 426 });
    }
    return admin(req);
  },
  websocket: {
    maxPayloadLength: 4 * 1024 * 1024,
    open(ws) {
      ws.data.conn = hub.open({ send: (t) => void ws.send(t), close: (c, r) => ws.close(c, r) });
    },
    message(ws, msg) {
      if (ws.data.conn && typeof msg === "string") hub.message(ws.data.conn, msg);
    },
    close(ws, code, reason) {
      if (ws.data.conn) hub.closed(ws.data.conn, `closed ${code} ${reason}`);
    },
  },
});

setInterval(() => controller?.wake(), 2_000);
controller.wake();
