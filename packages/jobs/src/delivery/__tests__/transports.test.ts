/**
 * The notification transports against a local stand-in for each provider.
 *
 * Only the network step is replaced: `egressFetch` answers from a small fake
 * per provider host that responds the way the provider documents (statuses,
 * bodies, Retry-After, FCM's google.rpc.Status, Google's OAuth errors,
 * Twilio's error codes). Everything above it is the product's own code: the
 * request builders, the bounded 429/5xx retry, the text limits, the FCM
 * HTTP v1 token exchange and send.
 *
 *   - push goes through FCM HTTP v1 with a service account (the legacy API
 *     is gone), and a dead device token is a permanent failure;
 *   - every Discord alert carries `?with_components=true` (Components V2
 *     messages are rejected without it);
 *   - 429/5xx are retried within a bounded budget, a long Retry-After is
 *     reported instead of slept through, provider text limits are held,
 *     PagerDuty does not page for `info`, Slack gets no `username`.
 */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import * as z from "zod";

import type { ChannelEvent, ResolvedChannel } from "../types";

type Deliver = typeof import("../channels").deliverToChannel;
type DeliverExternal = typeof import("../notify").deliverExternal;
type SendFcm = typeof import("../fcm").sendFcm;
type EgressModule = typeof import("@otterdeploy/shared/egress-policy");

const FCM_PROJECT = "otter-test";
const DEVICE = "fcm-device-token-active-0001";
const DEAD_DEVICE = "fcm-device-token-uninstalled-0002";
const DISCORD_URL = "https://discord.com/api/webhooks/1300000000000000001/webhook-token";
const SLACK_URL = "https://hooks.slack.com/services/T000000001/B000000001/slack-token";
const ROUTING_KEY = "0123456789abcdef0123456789abcdef";
const BOT_TOKEN = "123456789:test-bot-token";
const CHAT_ID = "100000001";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** What the product's env reads: mutable per test. */
const env: Record<string, unknown> = {
  BETTER_AUTH_URL: "https://cp.example.test",
  PUBLIC_API_URL: "https://cp.example.test",
  PUBLIC_WEB_URL: "https://cp.example.test",
  CORS_ORIGIN: ["https://cp.example.test"],
  OTTERDEPLOY_EGRESS_ALLOWLIST: [],
  TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "twilio-auth-token",
  TWILIO_FROM_NUMBER: "+15005550006",
};

let accountCounter = 0;
/** A key file for a fresh service account, so no test sees another's cached
 *  access token. */
function accountJson(tokenUri = "https://oauth2.googleapis.com/token"): string {
  accountCounter += 1;
  return JSON.stringify({
    type: "service_account",
    project_id: FCM_PROJECT,
    private_key_id: "test",
    private_key: privateKey,
    client_email: `push-${accountCounter}@${FCM_PROJECT}.iam.gserviceaccount.com`,
    token_uri: tokenUri,
  });
}

// ── the fake providers ─────────────────────────────────────────────────────

interface SentRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string;
}

interface FakeAnswer {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Thrown instead of answering (a transport failure). */
  error?: Error;
}

type Responder = (sent: SentRequest) => FakeAnswer;

const sent: SentRequest[] = [];
/** Per host, answers queued ahead of the default responder. */
const queued = new Map<string, FakeAnswer[]>();
const responders = new Map<string, Responder>();

function sentTo(host: string, path?: string): SentRequest[] {
  return sent.filter(
    (r) => r.url.hostname === host && (path === undefined || r.url.pathname === path),
  );
}

function queue(host: string, ...answers: FakeAnswer[]): void {
  queued.set(host, [...(queued.get(host) ?? []), ...answers]);
}

const issuedTokens: string[] = [];

/** Google's token endpoint: verifies the RS256 assertion like Google does. */
function googleToken(request: SentRequest): FakeAnswer {
  const form = new URLSearchParams(request.body);
  const assertion = form.get("assertion") ?? "";
  const [header, claims, signature] = assertion.split(".");
  const valid =
    form.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer" &&
    header !== undefined &&
    claims !== undefined &&
    signature !== undefined &&
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      createPublicKey(publicKey),
      Buffer.from(signature, "base64url"),
    );
  if (!valid)
    return {
      status: 400,
      body: { error: "invalid_grant", error_description: "Invalid JWT Signature." },
    };
  const parsed = z
    .object({ scope: z.string(), iat: z.number(), exp: z.number() })
    .parse(JSON.parse(Buffer.from(claims ?? "", "base64url").toString()));
  if (!parsed.scope.includes("firebase.messaging") || parsed.exp - parsed.iat > 3600)
    return { status: 400, body: { error: "invalid_scope" } };
  const token = `ya29.test-${issuedTokens.length}`;
  issuedTokens.push(token);
  return { status: 200, body: { access_token: token, expires_in: 3599, token_type: "Bearer" } };
}

/** FCM HTTP v1 messages:send. */
function fcmSend(request: SentRequest): FakeAnswer {
  const bearer = request.headers.authorization?.replace(/^Bearer /, "");
  if (!bearer || !issuedTokens.includes(bearer))
    return { status: 401, body: { error: { code: 401, status: "UNAUTHENTICATED" } } };
  const body = z
    .object({
      message: z.object({ token: z.string().optional(), data: z.record(z.string(), z.string()) }),
    })
    .parse(JSON.parse(request.body));
  if (body.message.token === DEAD_DEVICE)
    return {
      status: 404,
      body: {
        error: {
          code: 404,
          message: "Requested entity was not found.",
          status: "NOT_FOUND",
          details: [
            {
              "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
              errorCode: "UNREGISTERED",
            },
          ],
        },
      },
    };
  return { status: 200, body: { name: `projects/${FCM_PROJECT}/messages/0:1` } };
}

function twilioMessage(request: SentRequest): FakeAnswer {
  const form = new URLSearchParams(request.body);
  const to = form.get("To") ?? "";
  if (!/^\+[1-9]\d{6,14}$/.test(to))
    return {
      status: 400,
      body: {
        code: 21211,
        message: `The 'To' number ${to} is not a valid phone number.`,
        status: 400,
      },
    };
  if ((form.get("Body") ?? "").length > 1600)
    return {
      status: 400,
      body: {
        code: 21617,
        message: "The concatenated message body exceeds the 1600 character limit.",
        status: 400,
      },
    };
  return { status: 201, body: { sid: `SM${"0".repeat(32)}`, status: "queued" } };
}

/** sendMessage with parse_mode HTML: the 4096 limit counts the visible text,
 *  after tags are dropped and entities decoded. */
function telegramSend(request: SentRequest): FakeAnswer {
  const text = z.object({ text: z.string() }).parse(JSON.parse(request.body)).text;
  const visible = text
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
  if (visible.length > 4096)
    return {
      status: 400,
      body: { ok: false, error_code: 400, description: "Bad Request: message is too long" },
    };
  return { status: 200, body: { ok: true, result: { message_id: 1 } } };
}

responders.set("oauth2.googleapis.com", googleToken);
responders.set("fcm.googleapis.com", fcmSend);
responders.set("api.twilio.com", twilioMessage);
responders.set("api.telegram.org", telegramSend);
responders.set("discord.com", () => ({ status: 200, body: { id: "1", type: 0 } }));
responders.set("hooks.slack.com", () => ({ status: 200, body: "ok" }));
responders.set("events.pagerduty.com", () => ({ status: 202, body: { status: "success" } }));

function answerOf(fake: FakeAnswer, url: URL) {
  const text = typeof fake.body === "string" ? fake.body : JSON.stringify(fake.body ?? "");
  const headers = new Headers(fake.headers);
  return {
    status: fake.status,
    ok: fake.status >= 200 && fake.status < 300,
    url: url.toString(),
    headers: { get: (name: string) => headers.get(name) },
    text: async () => text,
    json: async (): Promise<unknown> => JSON.parse(text),
    arrayBuffer: () => new Response(text).arrayBuffer(),
  };
}

let deliverToChannel: Deliver;
let deliverExternal: DeliverExternal;
let sendFcm: SendFcm;

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

function channel(kind: ResolvedChannel["kind"], target: string, secret: string | null = null) {
  return { id: "notifchan_test", kind, name: "#alerts", target, config: {}, secret };
}

function event(overrides: Partial<ChannelEvent> = {}): ChannelEvent {
  return {
    eventId: "deploy.failed",
    severity: "err",
    title: "Deploy failed",
    message: "Health check never passed.",
    data: { resource: "web", project: "shop" },
    ...overrides,
  };
}

function lastJson(host: string): unknown {
  return JSON.parse(sentTo(host).at(-1)?.body ?? "{}");
}

beforeAll(async () => {
  // Settings row: none (the env is the only configuration in these tests).
  const noRows = { from: () => ({ where: () => ({ limit: async () => [] }) }) };
  await mock.module("@otterdeploy/db", () => ({ db: { select: () => noRows } }));
  await mock.module("@otterdeploy/env/server", () => ({ env }));
  await mock.module("@otterdeploy/email", () => ({
    NotificationEmail: () => null,
    sendEmail: async () => ({ success: true }),
    sendViaSmtpServer: async () => ({ success: true }),
  }));
  // A copy: bun's mock.module patches the live namespace in place.
  const actual: EgressModule = { ...(await import("@otterdeploy/shared/egress-policy")) };
  // Only the provider hosts below are answered here; any other destination
  // (other test files share this module) goes to the real egress policy.
  const fakeFetch: EgressModule["egressFetch"] = async (rawUrl, init, options) => {
    const url = new URL(String(rawUrl));
    if (!responders.has(url.hostname) && !queued.has(url.hostname))
      return actual.egressFetch(rawUrl, init, options);
    const request: SentRequest = {
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
      ),
      body: typeof init?.body === "string" ? init.body : String(init?.body ?? ""),
    };
    sent.push(request);
    const next = queued.get(url.hostname)?.shift();
    const responder = responders.get(url.hostname);
    const fake = next ?? responder?.(request);
    if (!fake) throw new Error(`nothing queued for ${url.hostname}`);
    if (fake.error) throw fake.error;
    return answerOf(fake, url);
  };
  await mock.module("@otterdeploy/shared/egress-policy", () => ({
    ...actual,
    egressFetch: fakeFetch,
  }));
  ({ deliverToChannel } = await import("../channels"));
  ({ deliverExternal } = await import("../notify"));
  ({ sendFcm } = await import("../fcm"));
});

afterEach(() => {
  env.FCM_SERVICE_ACCOUNT_JSON = undefined;
  env.FCM_SERVER_KEY = undefined;
  sent.length = 0;
  queued.clear();
});

describe("Discord", () => {
  test("a channel webhook posts the Components V2 alert and waits for the stored message", async () => {
    expect(await deliverToChannel(channel("discord", DISCORD_URL), event())).toEqual({ ok: true });
    const posted = sentTo("discord.com").at(-1);
    expect(posted?.method).toBe("POST");
    expect(posted?.url.searchParams.get("with_components")).toBe("true");
    expect(posted?.url.searchParams.get("wait")).toBe("true");
  });

  test("a 429 is retried after the body's retry_after, then delivered", async () => {
    queue("discord.com", {
      status: 429,
      body: { message: "You are being rate limited.", retry_after: 0.05, global: false },
    });
    expect(await deliverToChannel(channel("discord", DISCORD_URL), event())).toEqual({ ok: true });
    expect(sentTo("discord.com")).toHaveLength(2);
  });

  test("a 429 asking for a minute fails now with the provider's window, one request", async () => {
    queue("discord.com", {
      status: 429,
      body: { message: "You are being rate limited.", retry_after: 65, global: true },
    });
    const result = await deliverToChannel(channel("discord", DISCORD_URL), event());
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(result.error).toContain("HTTP 429");
    expect(result.error).toContain("retry after 65s");
    expect(sentTo("discord.com")).toHaveLength(1);
  });

  test("a send that times out is a retryable failure, not an egress block", async () => {
    const actual = await import("@otterdeploy/shared/egress-policy");
    const timedOut = new actual.EgressPolicyError("Outbound request timed out.", "transport");
    queue(
      "discord.com",
      { status: 0, error: timedOut },
      { status: 0, error: timedOut },
      { status: 0, error: timedOut },
    );
    const result = await deliverToChannel(channel("discord", DISCORD_URL), event());
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(result.error).toContain("timed out");
    expect(result.error).not.toContain("egress");
  });
});

describe("Slack", () => {
  test("a message over the 3000-character section limit is shortened, and no username is sent", async () => {
    const result = await deliverToChannel(
      channel("slack", SLACK_URL),
      event({ message: "x".repeat(5_000) }),
    );
    expect(result).toEqual({ ok: true });
    const body = z
      .object({
        username: z.unknown().optional(),
        blocks: z.array(z.object({ text: z.object({ text: z.string() }).optional() })),
      })
      .parse(lastJson("hooks.slack.com"));
    expect(body.username).toBeUndefined();
    expect(body.blocks[0]?.text?.text.length).toBeLessThanOrEqual(3_000);
  });

  test("a burst 429 with a short Retry-After is retried and delivered", async () => {
    queue("hooks.slack.com", {
      status: 429,
      body: "rate_limited",
      headers: { "retry-after": "0" },
    });
    expect(await deliverToChannel(channel("slack", SLACK_URL), event())).toEqual({ ok: true });
    expect(sentTo("hooks.slack.com")).toHaveLength(2);
  });

  test("Retry-After: 30 is reported, not slept through", async () => {
    queue("hooks.slack.com", {
      status: 429,
      body: "rate_limited",
      headers: { "retry-after": "30" },
    });
    const result = await deliverToChannel(channel("slack", SLACK_URL), event());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("retry after 30s");
    expect(sentTo("hooks.slack.com")).toHaveLength(1);
  });
});

describe("PagerDuty", () => {
  const pd = () => channel("pagerduty", "pagerduty", ROUTING_KEY);

  test("info is a change event; err triggers and ok resolves the same incident", async () => {
    expect(
      await deliverToChannel(pd(), event({ eventId: "deploy.started", severity: "info" })),
    ).toEqual({ ok: true });
    expect(sentTo("events.pagerduty.com").at(-1)?.url.pathname).toBe("/v2/change/enqueue");

    expect(await deliverToChannel(pd(), event())).toEqual({ ok: true });
    const trigger = z
      .object({ event_action: z.string(), dedup_key: z.string() })
      .parse(lastJson("events.pagerduty.com"));
    expect(sentTo("events.pagerduty.com").at(-1)?.url.pathname).toBe("/v2/enqueue");
    expect(trigger.event_action).toBe("trigger");

    expect(
      await deliverToChannel(pd(), event({ eventId: "deploy.succeeded", severity: "ok" })),
    ).toEqual({ ok: true });
    const resolve = z
      .object({ event_action: z.string(), dedup_key: z.string() })
      .parse(lastJson("events.pagerduty.com"));
    expect(resolve).toEqual({ ...resolve, event_action: "resolve", dedup_key: trigger.dedup_key });
  });

  test("a persistent 500 stops after three attempts", async () => {
    const outage = { status: 500, body: { status: "error" } };
    queue("events.pagerduty.com", outage, outage, outage, outage);
    const result = await deliverToChannel(pd(), event());
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(result.error).toContain("HTTP 500");
    expect(sentTo("events.pagerduty.com")).toHaveLength(3);
  });
});

describe("Telegram", () => {
  test("a message over 4096 characters is shortened, not rejected", async () => {
    const result = await deliverToChannel(
      channel("telegram", CHAT_ID, BOT_TOKEN),
      event({ message: "y".repeat(6_000) }),
    );
    expect(result).toEqual({ ok: true });
  });
});

describe("push channel, FCM HTTP v1", () => {
  test("a service account trades a signed assertion for a token and sends with string data", async () => {
    env.FCM_SERVICE_ACCOUNT_JSON = accountJson();
    expect(await deliverToChannel(channel("push", DEVICE), event())).toEqual({ ok: true });
    const send = sentTo("fcm.googleapis.com").at(-1);
    expect(send?.url.pathname).toBe(`/v1/projects/${FCM_PROJECT}/messages:send`);
    const body = z
      .object({ message: z.object({ token: z.string(), data: z.record(z.string(), z.string()) }) })
      .parse(JSON.parse(send?.body ?? "{}"));
    expect(body.message.token).toBe(DEVICE);
    expect(body.message.data).toEqual({ resource: "web", project: "shop" });
  });

  test("an uninstalled app's token is a permanent failure named by FCM", async () => {
    env.FCM_SERVICE_ACCOUNT_JSON = accountJson();
    const result = await deliverToChannel(channel("push", DEAD_DEVICE), event());
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(result.error).toContain("UNREGISTERED (404)");
  });

  test("a legacy server key alone says how to migrate and sends nothing", async () => {
    env.FCM_SERVER_KEY = "legacy-server-key";
    const result = await deliverToChannel(channel("push", DEVICE), event());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("FCM_SERVICE_ACCOUNT_JSON");
    expect(result.error).not.toContain("egress");
    expect(sentTo("fcm.googleapis.com")).toHaveLength(0);
  });

  test("quota exhaustion (Retry-After: 60) fails retryable, without a retry loop", async () => {
    env.FCM_SERVICE_ACCOUNT_JSON = accountJson();
    queue("fcm.googleapis.com", {
      status: 429,
      headers: { "retry-after": "60" },
      body: {
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          details: [{ errorCode: "QUOTA_EXCEEDED" }],
        },
      },
    });
    const result = await deliverToChannel(channel("push", DEVICE), event());
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(result.error).toContain("retry after 60s");
    expect(sentTo("fcm.googleapis.com")).toHaveLength(1);
  });

  test("one access token serves many sends", async () => {
    env.FCM_SERVICE_ACCOUNT_JSON = accountJson();
    expect(await deliverToChannel(channel("push", DEVICE), event())).toEqual({ ok: true });
    expect(await deliverToChannel(channel("push", DEVICE), event())).toEqual({ ok: true });
    expect(sentTo("oauth2.googleapis.com", "/token")).toHaveLength(1);
  });

  test("a refused grant says what Google said", async () => {
    env.FCM_SERVICE_ACCOUNT_JSON = accountJson();
    queue("oauth2.googleapis.com", {
      status: 400,
      body: { error: "invalid_grant", error_description: "Invalid JWT Signature." },
    });
    const result = await deliverToChannel(channel("push", DEVICE), event());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid_grant");
  });

  test("a grant answered without a token is a failure", async () => {
    env.FCM_SERVICE_ACCOUNT_JSON = accountJson();
    queue("oauth2.googleapis.com", { status: 200, body: { token_type: "Bearer" } });
    const result = await deliverToChannel(channel("push", DEVICE), event());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("without an access token");
  });

  test("an unreachable token endpoint is a failure, not a hang", async () => {
    env.FCM_SERVICE_ACCOUNT_JSON = accountJson("https://oauth2.unreachable.test/token");
    const refused = new Error("connect ECONNREFUSED");
    queue(
      "oauth2.unreachable.test",
      { status: 0, error: refused },
      { status: 0, error: refused },
      { status: 0, error: refused },
    );
    const result = await deliverToChannel(channel("push", DEVICE), event());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("FCM token exchange failed");
  });

  test("a malformed key file is reported, not sent", async () => {
    env.FCM_SERVICE_ACCOUNT_JSON = "{not json";
    const notJson = await deliverToChannel(channel("push", DEVICE), event());
    expect(notJson.error).toBe("FCM service account is not valid JSON");
    env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: "service_account" });
    const partial = await deliverToChannel(channel("push", DEVICE), event());
    expect(partial.error).toContain("project_id");
    expect(partial.error).toContain("private_key");
    expect(sent).toHaveLength(0);
  });

  test("a 503 is retried and the push lands", async () => {
    env.FCM_SERVICE_ACCOUNT_JSON = accountJson();
    queue("fcm.googleapis.com", {
      status: 503,
      body: { error: { code: 503, status: "UNAVAILABLE" } },
    });
    expect(await deliverToChannel(channel("push", DEVICE), event())).toEqual({ ok: true });
    expect(sentTo("fcm.googleapis.com")).toHaveLength(2);
  });

  test("a topic target is sent as a topic", async () => {
    const parsed = (await import("../fcm")).parseFcmServiceAccount(accountJson());
    if (parsed.isErr()) throw new Error(parsed.error);
    expect(await sendFcm(parsed.value, { target: "/topics/ops", title: "t", body: "b" })).toEqual({
      ok: true,
    });
    const body = z
      .object({ message: z.object({ topic: z.string(), token: z.string().optional() }) })
      .parse(lastJson("fcm.googleapis.com"));
    expect(body.message).toMatchObject({ topic: "ops" });
    expect(body.message.token).toBeUndefined();
  });
});

describe("per-user push and SMS (notification.send)", () => {
  test("push carries non-string data as strings and not the device token", async () => {
    env.FCM_SERVICE_ACCOUNT_JSON = accountJson();
    const outcome = await deliverExternal({
      channel: "push",
      userId: "user_test",
      title: "Backup finished",
      message: "3 databases",
      data: { deviceToken: DEVICE, count: 3, detail: { size: "1 GB" } },
      log: silentLog,
    });
    expect(outcome).toEqual({ status: "delivered" });
    const body = z
      .object({ message: z.object({ data: z.record(z.string(), z.string()) }) })
      .parse(lastJson("fcm.googleapis.com"));
    expect(body.message.data).toEqual({ count: "3", detail: '{"size":"1 GB"}' });
  });

  test("an SMS over Twilio's 1600-character limit is shortened and sent", async () => {
    const outcome = await deliverExternal({
      channel: "sms",
      userId: "user_test",
      title: "Deploy failed",
      message: "z".repeat(2_000),
      data: { phone: "+14155550123" },
      log: silentLog,
    });
    expect(outcome).toEqual({ status: "delivered" });
  });

  test("an invalid number is a permanent failure with Twilio's code", async () => {
    const outcome = await deliverExternal({
      channel: "sms",
      userId: "user_test",
      title: "Deploy failed",
      message: "x",
      data: { phone: "not-a-number" },
      log: silentLog,
    });
    expect(outcome).toMatchObject({ status: "failed", retryable: false });
    expect(outcome.status === "failed" && outcome.error).toContain("21211");
  });
});
