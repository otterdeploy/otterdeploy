/**
 * Firebase Cloud Messaging, HTTP v1.
 *
 * Push used to POST `https://fcm.googleapis.com/fcm/send` with
 * `Authorization: key=<server key>`: the legacy API Google deprecated in 2023
 * and shut down from 2024-07-22 (Firebase FAQ, "How and when will the
 * deprecated APIs be shut down?"; migration guide
 * https://firebase.google.com/docs/cloud-messaging/migrate-v1). Every push
 * failed, and since 2024-05-20 a new Firebase project cannot even obtain a
 * legacy key. HTTP v1 is the only API left:
 *
 *   1. Sign a JWT with the service account's private key (RS256; `iss` the
 *      account email, `scope` firebase.messaging, `aud` the key file's
 *      `token_uri`, one hour) and trade it at `token_uri` for an OAuth access
 *      token (RFC 7523 JWT bearer grant). Tokens are cached until shortly
 *      before they expire.
 *   2. `POST /v1/projects/{project_id}/messages:send` with
 *      `{ message: { token | topic, notification, data } }`. One target per
 *      request, and the answer is about that target alone: a 200 carries the
 *      message `name`, anything else is a `google.rpc.Status` naming why
 *      (UNREGISTERED, INVALID_ARGUMENT, QUOTA_EXCEEDED, ...). The legacy API's
 *      200-with-per-token-errors shape, which used to count a dead token as
 *      delivered, does not exist here.
 *
 * v1 rejects a `data` value that is not a string (400 INVALID_ARGUMENT), so
 * every value is stringified. Reserved keys (`from`, `message_type`,
 * `google.*`, `gcm.*`) would fail the whole send, so they are left out.
 */

import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import * as z from "zod";

import type { DeliveryResult } from "./types";

import {
  declinedRetryNote,
  httpFailure,
  type ProviderResponse,
  RETRYABLE_STATUSES,
  type RequestFailure,
  request,
} from "./post";

const FCM_API = "https://fcm.googleapis.com";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
/** Google caps an assertion's lifetime at one hour. */
const ASSERTION_LIFETIME_SECONDS = 3600;
/** Refresh a cached access token this long before Google says it expires. */
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

/** The fields HTTP v1 needs from the JSON key file Firebase hands out
 *  (Project settings → Service accounts → Generate new private key). */
const fcmServiceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().includes("PRIVATE KEY"),
  token_uri: z.url().default(GOOGLE_TOKEN_URI),
});
export type FcmServiceAccount = z.infer<typeof fcmServiceAccountSchema>;

/** Validate a service-account key file's JSON text. */
export function parseFcmServiceAccount(raw: string): Result<FcmServiceAccount, string> {
  const parsed = Result.try(() => fcmServiceAccountSchema.safeParse(JSON.parse(raw)));
  if (parsed.isErr()) return Result.err("FCM service account is not valid JSON");
  if (!parsed.value.success) {
    const fields = parsed.value.error.issues.map((issue) => issue.path.join(".")).join(", ");
    return Result.err(`FCM service account key file is missing or has invalid: ${fields}`);
  }
  return Result.ok(parsed.value.data);
}

export interface FcmMessage {
  /** A registration token, or `/topics/<name>` for a topic. */
  target: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const sendResponseSchema = z.object({ name: z.string().min(1) });

const googleErrorSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
    details: z.array(z.object({ errorCode: z.string().optional() }).loose()).optional(),
  }),
});

const oauthErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

/** Cached access tokens by service account (email + token endpoint). */
const accessTokens = new Map<string, { token: string; refreshAt: number }>();

function base64url(bytes: Uint8Array | string): string {
  return Buffer.from(bytes).toString("base64url");
}

async function signAssertion(account: FcmServiceAccount): Promise<string> {
  const issuedAt = Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: account.token_uri,
      iat: issuedAt,
      exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
    }),
  );
  const der = Buffer.from(
    account.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, ""),
    "base64",
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

function oauthFailure(response: ProviderResponse): string {
  const body = Result.try(() => oauthErrorSchema.parse(JSON.parse(response.text)));
  if (body.isErr()) return `FCM token exchange failed: ${httpFailure(response)}`;
  const detail = body.value.error_description ? ` (${body.value.error_description})` : "";
  return `FCM token exchange failed: ${body.value.error}${detail}`;
}

/** A valid OAuth access token for the account, from cache or a fresh grant. */
async function resolveAccessToken(account: FcmServiceAccount): Promise<Result<string, string>> {
  const cacheKey = `${account.client_email} ${account.token_uri}`;
  const cached = accessTokens.get(cacheKey);
  const now = Temporal.Now.instant().epochMilliseconds;
  if (cached && cached.refreshAt > now) return Result.ok(cached.token);

  const assertion = await Result.tryPromise({
    try: () => signAssertion(account),
    catch: () => "FCM service account private_key could not be loaded (not a PKCS#8 RSA key)",
  });
  if (assertion.isErr()) return assertion;

  const answered = await request(
    account.token_uri,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: JWT_BEARER_GRANT,
        assertion: assertion.value,
      }).toString(),
    },
    { followRedirects: false },
  );
  if (answered.isErr()) {
    return Result.err(`FCM token exchange failed: ${answered.error.message}`);
  }
  if (!answered.value.ok) return Result.err(oauthFailure(answered.value));
  const token = Result.try(() => tokenResponseSchema.parse(JSON.parse(answered.value.text)));
  if (token.isErr()) return Result.err("FCM token exchange answered without an access token");

  accessTokens.set(cacheKey, {
    token: token.value.access_token,
    refreshAt: now + token.value.expires_in * 1000 - ACCESS_TOKEN_REFRESH_MARGIN_MS,
  });
  return Result.ok(token.value.access_token);
}

const RESERVED_DATA_KEY = /^(from|message_type|google\..*|gcm\..*|google|gcm)$/;

/** `data` as v1 accepts it: string values only, reserved keys left out. */
function fcmData(data: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value === undefined || value === null || RESERVED_DATA_KEY.test(key)) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

/** The v1 message for a target: `/topics/x` is a topic, anything else a token. */
function fcmMessageBody(message: FcmMessage) {
  const topic = message.target.startsWith("/topics/")
    ? message.target.slice("/topics/".length)
    : undefined;
  return {
    message: {
      ...(topic === undefined ? { token: message.target } : { topic }),
      notification: { title: message.title, body: message.body },
      data: fcmData(message.data),
    },
  };
}

/** `FCM UNREGISTERED (404): Requested entity was not found.` */
function sendFailure(response: ProviderResponse): string {
  const body = Result.try(() => googleErrorSchema.parse(JSON.parse(response.text)));
  if (body.isErr()) return `FCM send failed: ${httpFailure(response)}`;
  const { error } = body.value;
  const code = error.details?.find((d) => d.errorCode)?.errorCode ?? error.status ?? "error";
  const message = error.message ? `: ${error.message}` : "";
  return `FCM ${code} (${response.status})${message}${declinedRetryNote(response)}`;
}

async function postMessage(
  account: FcmServiceAccount,
  accessToken: string,
  message: FcmMessage,
): Promise<Result<ProviderResponse, RequestFailure>> {
  return request(
    `${FCM_API}/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(fcmMessageBody(message)),
    },
    { followRedirects: false },
  );
}

/** Send one push. Never throws; `retryable` marks a failure worth a later try. */
export async function sendFcm(
  account: FcmServiceAccount,
  message: FcmMessage,
): Promise<DeliveryResult> {
  const token = await resolveAccessToken(account);
  if (token.isErr()) return { ok: false, error: token.error };

  let answered = await postMessage(account, token.value, message);
  // A token revoked or expired early: forget it and grant a new one, once.
  if (answered.isOk() && answered.value.status === 401) {
    accessTokens.delete(`${account.client_email} ${account.token_uri}`);
    const fresh = await resolveAccessToken(account);
    if (fresh.isErr()) return { ok: false, error: fresh.error };
    answered = await postMessage(account, fresh.value, message);
  }
  if (answered.isErr()) {
    return { ok: false, error: answered.error.message, retryable: answered.error.retryable };
  }

  const response = answered.value;
  if (!response.ok) {
    return {
      ok: false,
      error: sendFailure(response),
      retryable: RETRYABLE_STATUSES.has(response.status),
    };
  }
  // A 200 without a message name is not an accepted message.
  const sent = Result.try(() => sendResponseSchema.parse(JSON.parse(response.text)));
  return sent.isOk()
    ? { ok: true }
    : { ok: false, error: "FCM answered 200 without a message name", retryable: false };
}
