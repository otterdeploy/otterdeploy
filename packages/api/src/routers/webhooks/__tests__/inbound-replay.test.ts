import { hmacSha256Hex } from "@otterdeploy/shared/crypto";
/**
 * An inbound webhook call cannot be replayed.
 *
 * The call is signed over id.timestamp.body; the handler refuses a timestamp
 * outside the window, a webhook-id it already accepted for the endpoint, and
 * the older body-only X-Otterdeploy-Signature (which signed no timestamp, so a
 * captured request re-triggered a deploy forever). The endpoint row, the
 * secret store and the seen-id store are doubles; the verification is real.
 */
import { signWebhook } from "@otterdeploy/shared/webhook-signature";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const SECRET = "inhsec_0123456789abcdef";
const NOW = 1_760_000_000;

vi.mock("../queries", () => ({
  getInboundByToken: async (token: string) =>
    token === "tok"
      ? {
          endpoint: {
            id: "inb_1",
            name: "ci",
            status: "active",
            ipAllowlist: [],
            encryptedSecret: "sealed",
            action: "none",
          },
          service: null,
          projectId: null,
          projectSlug: null,
        }
      : null,
  touchInboundInvokedAt: async () => undefined,
}));
vi.mock("@otterdeploy/jobs/delivery/secret-crypto", () => ({
  decryptSecret: async () => SECRET,
}));

const { handleInboundInvocation } = await import("../inbound");

function memoryReplayGuard() {
  const seen = new Set<string>();
  return async (endpointId: string, id: string) => {
    const key = `${endpointId}:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

let replayGuard = memoryReplayGuard();
let clock = NOW;
const deps = () => ({ replayGuard, nowSeconds: () => clock });

beforeEach(() => {
  replayGuard = memoryReplayGuard();
  clock = NOW;
});

const BODY = '{"event":"trigger"}';
const bytes = (text: string) => {
  const encoded = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);
  return buf;
};

async function signed(id: string, timestamp = NOW) {
  return {
    webhookId: id,
    webhookTimestamp: String(timestamp),
    webhookSignature: await signWebhook(SECRET, { id, timestamp, body: BODY }),
  };
}

function invoke(headers: {
  webhookId?: string | null;
  webhookTimestamp?: string | null;
  webhookSignature?: string | null;
  signatureHeader?: string | null;
}) {
  return handleInboundInvocation(
    {
      token: "tok",
      webhookId: headers.webhookId ?? null,
      webhookTimestamp: headers.webhookTimestamp ?? null,
      webhookSignature: headers.webhookSignature ?? null,
      signatureHeader: headers.signatureHeader ?? null,
      rawBody: bytes(BODY),
      ip: "203.0.113.7",
      log: createRequestLogger({ method: "POST", path: "/api/webhooks/in/tok" }),
    },
    deps(),
  );
}

describe("inbound webhook replay", () => {
  it("accepts a freshly signed call", async () => {
    const res = await invoke(await signed("evt_1"));
    expect(res.status).toBe(200);
  });

  it("refuses the same call delivered twice (captured and replayed inside the window)", async () => {
    const headers = await signed("evt_2");
    expect((await invoke(headers)).status).toBe(200);
    clock = NOW + 30;
    const replay = await invoke(headers);
    expect(replay.status).toBe(409);
    expect(replay.body.ok).toBe(false);
  });

  it("refuses a captured call replayed after the window", async () => {
    const headers = await signed("evt_3");
    clock = NOW + 60 * 60;
    const res = await invoke(headers);
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("too old");
  });

  it("refuses the older body-only X-Otterdeploy-Signature, which signs no timestamp", async () => {
    const res = await invoke({ signatureHeader: `sha256=${await hmacSha256Hex(SECRET, BODY)}` });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("webhook-timestamp");
  });

  it("refuses a forged signature without burning the id", async () => {
    const headers = await signed("evt_4");
    const forged = await invoke({ ...headers, webhookSignature: "v1,AAAA" });
    expect(forged.status).toBe(401);
    expect((await invoke(headers)).status).toBe(200);
  });

  it("fails closed when the seen-id store is unreachable", async () => {
    replayGuard = async () => {
      throw new Error("connection refused");
    };
    const res = await invoke(await signed("evt_5"));
    expect(res.status).toBe(503);
  });
});
