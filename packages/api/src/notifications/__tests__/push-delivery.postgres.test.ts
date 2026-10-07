/**
 * The per-user push path (`notification.send`) on a migrated database, with
 * Google's token endpoint and FCM HTTP v1 stood in for at the network step.
 *
 * The job used to POST the shut-down legacy FCM API, throw on its answer and,
 * with `attempts: 3`, write one in-app row per attempt: three identical
 * notifications for one event. Now the row is keyed by the job's occurrence,
 * a retryable failure (quota, outage) throws for BullMQ to retry, and a
 * permanent one (an uninstalled app's token) ends the job with
 * UnrecoverableError.
 */
import { db } from "@otterdeploy/db";
import { notification, user } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vite-plus/test";

import { uniq } from "../../__tests__/postgres-seed";

const DEVICE = "fcm-device-token-active-0001";
const DEAD_DEVICE = "fcm-device-token-uninstalled-0002";

const provider = await vi.hoisted(async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  // oxlint-disable-next-line node/no-process-env -- test env boundary: the service account must be in the env before @otterdeploy/env evaluates it
  process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: "service_account",
    project_id: "otter-test",
    private_key_id: "test",
    private_key: privateKey,
    client_email: "push@otter-test.iam.gserviceaccount.com",
    token_uri: "https://oauth2.googleapis.com/token",
  });
  return { sends: 0, quotaExhausted: false };
});

function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  const lookup = new Headers(headers);
  return {
    status,
    ok: status >= 200 && status < 300,
    url: "",
    headers: { get: (name: string) => lookup.get(name) },
    text: async () => text,
    json: async (): Promise<unknown> => JSON.parse(text),
    arrayBuffer: () => new Response(text).arrayBuffer(),
  };
}

// Google's two hosts are answered here; every other request runs the real
// egress policy.
vi.mock("@otterdeploy/shared/egress-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@otterdeploy/shared/egress-policy")>();
  const egressFetch: typeof actual.egressFetch = async (url, init, options) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "oauth2.googleapis.com")
      return answer(200, { access_token: "ya29.test", expires_in: 3599, token_type: "Bearer" });
    if (parsed.hostname !== "fcm.googleapis.com") return actual.egressFetch(url, init, options);
    provider.sends++;
    if (provider.quotaExhausted)
      return answer(
        429,
        {
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            details: [{ errorCode: "QUOTA_EXCEEDED" }],
          },
        },
        { "retry-after": "60" },
      );
    if (String(init?.body).includes(DEAD_DEVICE))
      return answer(404, {
        error: {
          code: 404,
          message: "Requested entity was not found.",
          status: "NOT_FOUND",
          details: [{ errorCode: "UNREGISTERED" }],
        },
      });
    return answer(200, { name: "projects/otter-test/messages/0:1" });
  };
  return { ...actual, egressFetch };
});

const { deliverNotification } = await import("@otterdeploy/jobs/jobs/notification");

/** BullMQ's "do not retry" error, by name (api does not depend on bullmq). */
function isUnrecoverable(error: unknown): boolean {
  return error instanceof Error && error.name === "UnrecoverableError";
}

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

async function seedUser(): Promise<string> {
  const [row] = await db
    .insert(user)
    .values({ name: "push", email: `push-${uniq()}@otterdeploy.test` })
    .returning({ id: user.id });
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function userNotifications(userId: string) {
  return db.select().from(notification).where(eq(notification.userId, userId));
}

/** Run every BullMQ attempt of one job (same occurrence) until it stops throwing. */
async function runAttempts(payload: Parameters<typeof deliverNotification>[0], attempts: number) {
  const occurrence = `job:${uniq()}`;
  const errors: unknown[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const outcome = await Result.tryPromise({
      try: () => deliverNotification(payload, { log: silentLog, occurrence }),
      catch: (error) => error,
    });
    if (outcome.isOk()) return { result: outcome.value, errors };
    errors.push(outcome.error);
    if (isUnrecoverable(outcome.error)) break;
  }
  return { result: null, errors };
}

describe("notification.send push over FCM HTTP v1", () => {
  it("delivers the push and writes one in-app row", async () => {
    const userId = await seedUser();
    const { result, errors } = await runAttempts(
      {
        userId,
        type: "push",
        title: "Backup finished",
        message: "3 databases",
        data: { deviceToken: DEVICE, count: 3 },
      },
      3,
    );
    expect(errors).toEqual([]);
    expect(result?.externalDelivered).toBe(true);
    expect(await userNotifications(userId)).toHaveLength(1);
  });

  it("an exhausted quota fails every attempt retryably and still leaves exactly one row", async () => {
    const userId = await seedUser();
    const before = provider.sends;
    provider.quotaExhausted = true;
    const { result, errors } = await runAttempts(
      {
        userId,
        type: "push",
        title: "Deploy failed",
        message: "web",
        data: { deviceToken: DEVICE },
      },
      3,
    );
    provider.quotaExhausted = false;
    expect(result).toBeNull();
    expect(errors).toHaveLength(3);
    for (const error of errors) {
      expect(isUnrecoverable(error)).toBe(false);
      expect(String(error)).toContain("QUOTA_EXCEEDED");
    }
    // Retry-After: 60 is past what one attempt sleeps through: one send each.
    expect(provider.sends - before).toBe(3);
    expect(await userNotifications(userId)).toHaveLength(1);
  });

  it("an uninstalled app's token ends the job at once", async () => {
    const userId = await seedUser();
    const { errors } = await runAttempts(
      {
        userId,
        type: "push",
        title: "Deploy failed",
        message: "web",
        data: { deviceToken: DEAD_DEVICE },
      },
      3,
    );
    expect(errors).toHaveLength(1);
    expect(isUnrecoverable(errors[0])).toBe(true);
    expect(String(errors[0])).toContain("UNREGISTERED");
    expect(await userNotifications(userId)).toHaveLength(1);
  });
});
