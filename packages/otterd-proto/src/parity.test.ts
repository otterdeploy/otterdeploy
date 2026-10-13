/**
 * Parity with the Rust contract: every fixture the Rust crate generates must
 * parse here and come back unchanged, and every shared function must agree.
 * Regenerate fixtures on the Rust side (`OTTERD_PROTO_BLESS=1 cargo test`).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod";

import { bulkFrame, decodeDataHeader, encodeDataHeader, pipe } from "./bulk";
import { PERMISSIONS, VERB_TABLE, VERBS, capability } from "./capability";
import { controlFrame, sessionProof } from "./channel";
import { command, commandResult, encodeCommand, opOutcome } from "./command";
import {
  challengeAnswer,
  discoveryMessage,
  membership,
  ownerSnapshot,
  peerAnswer,
  servingSet,
} from "./discovery";
import {
  SIGN_CONTEXTS,
  keyIdOf,
  publicKeyFromSeed,
  sha256HexOf,
  signContext,
  signEnvelope,
  signedEnvelope,
  verifyAndParse,
  verifyEnvelope,
} from "./envelope";
import { CAUSES, OUTCOMES, healthCheck, outcome, roundOutcome } from "./health";
import {
  NODE_ROLES,
  authorityRevocation,
  cpKeyTransition,
  crossSigned,
  enrollCertificate,
  enrollRequest,
  keyRotation,
} from "./identity";
import { journalEntry } from "./journal";
import { leaseRenewal, slotGrant, slotReport, stopCertificate } from "./lifecycle";
import { METRIC_NAMES, SIGNAL_KINDS, sampleBatch } from "./metrics";
import { SPEC_ISSUE_CODES, serviceSpec, serviceSpecInput, specIssue } from "./spec";
import { normalizeServiceSpec, validateServiceSpec } from "./spec-rules";
import { FEATURES, negotiate, versionRange } from "./version";

const FIXTURES = join(import.meta.dir, "../../../apps/otterd/crates/otterd-proto/fixtures");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, path), "utf8"));
}

const SCHEMAS: Record<string, z.ZodType> = {
  AuthorityRevocation: authorityRevocation,
  BulkFrame: bulkFrame,
  Capability: capability,
  ChallengeAnswer: challengeAnswer,
  Command: command,
  CommandResult: commandResult,
  ControlFrame: controlFrame,
  CpKeyTransition: cpKeyTransition,
  CrossSigned: crossSigned,
  DiscoveryMessage: discoveryMessage,
  EnrollCertificate: enrollCertificate,
  EnrollRequest: enrollRequest,
  HealthCheck: healthCheck,
  JournalEntry: journalEntry,
  KeyRotation: keyRotation,
  LeaseRenewal: leaseRenewal,
  Membership: membership,
  OpOutcome: opOutcome,
  OwnerSnapshot: ownerSnapshot,
  PeerAnswer: peerAnswer,
  SampleBatch: sampleBatch,
  ServingSet: servingSet,
  SessionProof: sessionProof,
  SignedEnvelope: signedEnvelope,
  SlotGrant: slotGrant,
  SlotReport: slotReport,
  StopCertificate: stopCertificate,
};

const schemaFile = z.object({ schema: z.string(), cases: z.array(z.unknown()) });

describe("schema fixtures", () => {
  const files = readdirSync(join(FIXTURES, "schemas")).filter((f) => f.endsWith(".json"));

  test("every Rust schema has a TypeScript mirror", () => {
    expect(files.map((f) => f.replace(/\.json$/, "")).toSorted()).toEqual(
      Object.keys(SCHEMAS).toSorted(),
    );
  });

  for (const file of files) {
    const { schema, cases } = schemaFile.parse(readJson(join("schemas", file)));
    test(`${schema} round-trips every case unchanged`, () => {
      const zod = SCHEMAS[schema];
      expect(zod).toBeDefined();
      for (const c of cases) {
        const parsed = zod?.safeParse(c);
        if (!parsed?.success) throw new Error(`${schema}: ${parsed?.error.message}`);
        expect(parsed.data).toEqual(c);
      }
    });
  }

  test("strict documents refuse unknown fields", () => {
    const { cases } = schemaFile.parse(readJson("schemas/Capability.json"));
    const first = z.record(z.string(), z.unknown()).parse(cases[0]);
    expect(capability.safeParse({ ...first, extra: true }).success).toBe(false);
  });
});

describe("enums", () => {
  const enums = z.record(z.string(), z.array(z.unknown())).parse(readJson("enums.json"));
  const same = (name: string, ours: readonly unknown[]) =>
    test(name, () => expect(enums[name]).toEqual([...ours]));
  same("Verb", VERBS);
  same("Permission", PERMISSIONS);
  same("SignContext", SIGN_CONTEXTS);
  same("Feature", FEATURES);
  same("NodeRole", NODE_ROLES);
  same("MetricName", METRIC_NAMES);
  same("Cause", CAUSES);
  same("Outcome", OUTCOMES);
  same("SignalKind", SIGNAL_KINDS);
  same("SpecIssueCode", SPEC_ISSUE_CODES);
  same(
    "VerbRequired",
    VERBS.map((v) => ({
      verb: v,
      required: VERB_TABLE[v].required,
      monitor: VERB_TABLE[v].monitor,
    })),
  );
});

describe("ServiceSpec normalization and validation", () => {
  const file = z
    .object({
      cases: z.array(
        z.object({
          name: z.string(),
          input: z.unknown(),
          normalized: z.unknown(),
          issues: z.array(specIssue),
        }),
      ),
    })
    .parse(readJson("spec-normalize.json"));
  for (const c of file.cases) {
    test(c.name, () => {
      const input = serviceSpecInput.parse(c.input);
      const normalized = normalizeServiceSpec(input);
      expect(normalized).toEqual(serviceSpec.parse(c.normalized));
      expect(serviceSpec.parse(normalized)).toEqual(normalized);
      expect(validateServiceSpec(normalized)).toEqual(c.issues);
    });
  }
});

describe("vectors", () => {
  const vectors = z
    .object({
      signatures: z.array(
        z.object({
          seedHex: z.string(),
          publicKey: z.string(),
          keyId: z.string(),
          context: signContext,
          payloadUtf8: z.string(),
          envelope: signedEnvelope,
          payloadDigest: z.string(),
        }),
      ),
      dataHeaders: z.array(z.object({ pipe, streamId: z.number(), hex: z.string() })),
      roundOutcome: z.array(
        z.object({ attempts: z.array(outcome), configured: z.number(), result: outcome }),
      ),
      negotiation: z.array(
        z.object({
          node: versionRange,
          cp: versionRange,
          result: z.union([z.object({ ok: z.number() }), z.object({ error: z.string() })]),
        }),
      ),
    })
    .parse(readJson("vectors.json"));

  test("Ed25519 envelopes are byte-identical and verify both ways", () => {
    for (const v of vectors.signatures) {
      const seed = Buffer.from(v.seedHex, "hex");
      expect(publicKeyFromSeed(seed)).toBe(v.publicKey);
      expect(keyIdOf(v.publicKey)).toBe(v.keyId);
      const payload = new TextEncoder().encode(v.payloadUtf8);
      expect(signEnvelope(seed, v.context, payload)).toEqual(v.envelope);
      expect(sha256HexOf(payload)).toBe(v.payloadDigest);
      const verified = verifyEnvelope(v.envelope, [v.publicKey], v.context);
      expect(verified.isOk()).toBe(true);
      const wrongContext =
        v.context === "otterd/lease/v1" ? "otterd/session/v1" : "otterd/lease/v1";
      expect(verifyEnvelope(v.envelope, [v.publicKey], wrongContext).isErr()).toBe(true);
      const tampered = { ...v.envelope, payload: Buffer.from("{}").toString("base64") };
      const bad = verifyEnvelope(tampered, [v.publicKey], v.context);
      expect(bad.isErr() && bad.error.kind).toBe("bad-signature");
    }
  });

  test("verifyAndParse returns only schema-valid payloads", () => {
    const v = vectors.signatures[0];
    if (v === undefined) throw new Error("no signature vector");
    const ok = verifyAndParse(
      v.envelope,
      [v.publicKey],
      v.context,
      z.object({ hello: z.string() }),
    );
    expect(ok.isOk() && ok.value.hello).toBe("otterd");
    const wrong = verifyAndParse(v.envelope, [v.publicKey], v.context, z.object({ x: z.number() }));
    expect(wrong.isErr() && wrong.error.kind).toBe("payload");
  });

  test("bulk data headers", () => {
    for (const h of vectors.dataHeaders) {
      const bytes = encodeDataHeader({ pipe: h.pipe, streamId: h.streamId });
      expect(Buffer.from(bytes).toString("hex")).toBe(h.hex);
      const decoded = decodeDataHeader(new Uint8Array([...bytes, 1, 2]));
      expect(decoded.isOk() && decoded.value.header).toEqual({
        pipe: h.pipe,
        streamId: h.streamId,
      });
    }
    expect(decodeDataHeader(new Uint8Array(3)).isErr()).toBe(true);
  });

  test("round outcome folding", () => {
    for (const r of vectors.roundOutcome) {
      expect(
        roundOutcome(
          r.attempts.map((o) => ({ outcome: o })),
          r.configured,
        ),
      ).toBe(r.result);
    }
  });

  test("version negotiation", () => {
    for (const n of vectors.negotiation) {
      const got = negotiate(n.node, n.cp);
      const actual: unknown = got.isOk() ? { ok: got.value } : { error: got.error };
      expect(actual).toEqual(n.result);
    }
  });
});

test("encodeCommand hashes the exact payload text", () => {
  const { payload, payloadHash } = encodeCommand({ verb: "op.status", opId: "op_1" });
  expect(payload).toBe('{"verb":"op.status","opId":"op_1"}');
  expect(payloadHash).toBe(sha256HexOf(new TextEncoder().encode(payload)));
  expect(command.safeParse(JSON.parse(payload)).success).toBe(true);
});
