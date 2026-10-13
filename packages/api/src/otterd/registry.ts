/**
 * Node enrollment. An install admin mints a single-use, short-lived token; a
 * node generates its keys locally and sends an enrollment request signed with
 * its new identity key (proof of possession). The control plane then:
 *
 * 1. verifies the request under that key and claims the token (once);
 * 2. appends the node's record to the off-node anchor and waits for it to be
 *    committed in the anchor head (append before any capability: a restore
 *    from an older database backup cannot forget this node);
 * 3. records the node at epoch 1 and signs its enrollment certificate, which
 *    pins the control-plane key the node will trust.
 *
 * Without an anchor (the single-host local-only profile) step 2 is skipped
 * and recorded as such.
 */
import { db } from "@otterdeploy/db";
import { otterdAuthority, otterdEnrollToken, otterdNode } from "@otterdeploy/db/schema/otterd";
import { type Signer, signEnrollCertificate } from "@otterdeploy/otterd-cp";
import {
  type EnrollCertificate,
  type SignedEnvelope,
  enrollRequest,
  keyIdOf,
  verifyAndParse,
} from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import * as z from "zod";

import type { EnrollOutcome, NodeRecord, ToolError } from "./tools";

import { type StoreFailure, mintId, refusal, toStoreFailure } from "./store/errors";
import { journal } from "./store/journal";

export interface RegistryConfig {
  signer: Signer;
  /** wss URL nodes dial, carried in the certificate. */
  controlUrl: string;
  /** Recovery root public key nodes pin (base64). */
  recoveryKey: string;
  /** Anchor append, or null for the local-only profile. */
  anchor: ((node: NodeRecord) => Promise<Result<EnrollOutcome, ToolError>>) | null;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Mint a single-use enrollment token. Only its hash is stored; the token is shown once. */
export function createEnrollToken(
  opts: { roles: string[]; labels: Record<string, string>; ttlMs: number; by: string },
  now: number,
): Promise<Result<{ tokenId: string; token: string; expiresAt: number }, StoreFailure>> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const tokenId = mintId("enroll");
  const expiresAt = now + Math.min(opts.ttlMs, 60 * 60_000);
  return Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      await db.insert(otterdEnrollToken).values({
        tokenId,
        tokenHash: sha256(token),
        roles: opts.roles,
        labels: opts.labels,
        createdBy: opts.by,
        createdAt: now,
        expiresAt,
      });
      return { tokenId, token, expiresAt };
    },
  });
}

/** Read the claimed identity key from the payload, then verify the request under it. */
function verifyRequest(envelope: SignedEnvelope) {
  const unverified = z
    .object({ keys: z.object({ identity: z.string() }) })
    .safeParse(
      Result.try((): unknown =>
        JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8")),
      ).unwrapOr(null),
    );
  if (!unverified.success)
    return Result.err(refusal("request-malformed", unverified.error.message));
  const verified = verifyAndParse(
    envelope,
    [unverified.data.keys.identity],
    "otterd/enroll-request/v1",
    enrollRequest,
  );
  return verified.isErr()
    ? Result.err(refusal("request-signature", verified.error.kind))
    : Result.ok(verified.value);
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "node";

export interface Enrolled {
  nodeId: string;
  certificate: SignedEnvelope;
}

export async function enroll(
  cfg: RegistryConfig,
  envelope: SignedEnvelope,
  now: number,
): Promise<Result<Enrolled, StoreFailure | ToolError>> {
  const req = verifyRequest(envelope);
  if (req.isErr()) return Result.err(req.error);
  const r = req.value;
  const claimed = await Result.tryPromise({
    catch: toStoreFailure,
    try: async () => {
      const [row] = await db
        .update(otterdEnrollToken)
        .set({ usedAt: now })
        .where(
          and(
            eq(otterdEnrollToken.tokenHash, sha256(r.token)),
            isNull(otterdEnrollToken.usedAt),
            gt(otterdEnrollToken.expiresAt, now),
          ),
        )
        .returning();
      if (!row) throw refusal("token-invalid", "the enrollment token is unknown, used or expired");
      return row;
    },
  });
  if (claimed.isErr()) return Result.err(claimed.error);
  const nodeId = `${slug(r.facts.hostname)}-${Buffer.from(crypto.getRandomValues(new Uint8Array(3))).toString("hex")}`;
  const identityKeyId = keyIdOf(r.keys.identity);
  let anchorSeq: number | null = null;
  if (cfg.anchor) {
    const appended = await cfg.anchor({ nodeId, nodeEpoch: 1, identityKeyId, host: r.host });
    if (appended.isErr()) return Result.err(appended.error);
    if (appended.value.result !== "committed") {
      return Result.err(
        refusal("anchor-frozen", `enrollment frozen (phase ${appended.value.phase})`),
      );
    }
    anchorSeq = appended.value.seq;
  }
  const roles = claimed.value.roles.filter((role) => r.requestedRoles.some((x) => x === role));
  return Result.tryPromise({
    catch: toStoreFailure,
    try: () =>
      db.transaction(async (tx) => {
        const [authority] = await tx.select().from(otterdAuthority).limit(1);
        if (!authority) throw refusal("no-authority", "the control plane has no issuing authority");
        const [{ next } = { next: 1 }] = await tx
          .select({ next: sql<number>`coalesce(max(${otterdNode.ordinal}), 0) + 1` })
          .from(otterdNode);
        const reserve = 512 * 1024 ** 2;
        await tx.insert(otterdNode).values({
          nodeId,
          ordinal: Number(next),
          nodeEpoch: 1,
          keyEpoch: r.keys.keyEpoch,
          identityKey: r.keys.identity,
          identityKeyId,
          roles: roles.length > 0 ? roles : claimed.value.roles,
          labels: claimed.value.labels,
          arch: r.facts.arch,
          host: r.host,
          facts: r.facts,
          allocatableNanoCpus: Math.floor(r.facts.cpuCores * 0.9 * 1e9),
          allocatableMemoryBytes: Math.max(0, Math.floor(r.facts.memoryBytes * 0.9) - reserve),
          anchorSeq,
          enrolledAt: now,
          updatedAt: now,
        });
        const cert: EnrollCertificate = {
          installId: authority.installId,
          nodeId,
          nodeEpoch: 1,
          authorityTerm: authority.authorityTerm,
          roles: roles.length > 0 ? roles.flatMap((x) => (isRole(x) ? [x] : [])) : [],
          identityKeyId,
          keyEpoch: r.keys.keyEpoch,
          host: r.host,
          cpKeys: [{ key: cfg.signer.publicKey, epoch: 1 }],
          recoveryKey: cfg.recoveryKey,
          controlUrl: cfg.controlUrl,
          issuedAtUnixMs: now,
          reason: "enrollment",
        };
        await journal(tx, {
          at: now,
          kind: "node-enrolled",
          nodeId,
          detail: { anchorSeq, roles: cert.roles, tokenId: claimed.value.tokenId },
        });
        return { nodeId, certificate: signEnrollCertificate(cfg.signer, cert) };
      }),
  });
}

const ROLES = ["worker", "edge", "build", "registry", "monitor", "platform"] as const;
const isRole = (x: string): x is (typeof ROLES)[number] => ROLES.some((r) => r === x);
