import type { Context } from "hono";

import {
  completeNodeEnrollment,
  parseEnrollmentCredential,
  redeemNodeEnrollment,
} from "@otterdeploy/api/routers/server/enrollment";
import { resolveCanonicalWebOrigin } from "@otterdeploy/auth/web-origin";
import { env } from "@otterdeploy/env/server";

import { buildNodeEnrollmentScript } from "./enrollment-script";

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function allowAttempt(id: string): boolean {
  const now = Date.now();
  if (attempts.size >= 10_000) {
    for (const [key, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(key);
    }
    if (attempts.size >= 10_000) {
      const oldest = attempts.keys().next().value;
      if (typeof oldest === "string") attempts.delete(oldest);
    }
  }
  const current = attempts.get(id);
  if (!current || current.resetAt <= now) {
    attempts.set(id, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  current.count++;
  return current.count <= MAX_ATTEMPTS;
}

function bearer(c: Context): string | null {
  return (
    c.req
      .header("authorization")
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim() ?? null
  );
}

function auditMachineAction(
  c: Context,
  enrollmentId: string,
  action: string,
  outcome: "success" | "denied" | "failure",
  reason?: string,
): void {
  const event = {
    action,
    actor: { type: "api" as const, id: enrollmentId },
    outcome,
    ...(reason ? { reason } : {}),
  };
  if (outcome === "denied") {
    c.get("log").audit?.deny(reason ?? "Denied", event);
  } else {
    c.get("log").audit?.(event);
  }
}

export async function redeemNodeEnrollmentHandler(c: Context): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const credential = bearer(c);
  const parsed = credential ? parseEnrollmentCredential(credential) : null;
  const pathId = c.req.param("id");
  if (!credential || !parsed || parsed.id !== pathId) {
    return c.json({ error: "Enrollment unavailable." }, 404);
  }
  if (!allowAttempt(pathId)) {
    c.header("Retry-After", "60");
    auditMachineAction(c, pathId, "node-enrollment.redeem", "denied", "Rate limit exceeded.");
    return c.json({ error: "Try again later." }, 429);
  }

  const redeemed = await redeemNodeEnrollment(credential);
  if (!redeemed) {
    auditMachineAction(c, pathId, "node-enrollment.redeem", "denied", "Enrollment unavailable.");
    return c.json({ error: "Enrollment unavailable." }, 404);
  }

  // Never derive this callback from Host/X-Forwarded-Host. The script sends
  // its bearer to this URL, so a spoofed request authority must not redirect
  // that credential to an attacker-controlled origin.
  const origin = await resolveCanonicalWebOrigin(env.PUBLIC_API_URL ?? env.BETTER_AUTH_URL);
  const completeUrl = `${origin}/api/node-enrollments/${redeemed.id}/complete`;
  const script = buildNodeEnrollmentScript({
    joinToken: redeemed.joinToken,
    managerAddr: redeemed.managerAddr,
    completeUrl,
    credential,
  });

  auditMachineAction(c, pathId, "node-enrollment.redeem", "success");
  return c.text(script, 200, {
    "Content-Type": "text/x-shellscript; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
}

export async function completeNodeEnrollmentHandler(c: Context): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const credential = bearer(c);
  const parsed = credential ? parseEnrollmentCredential(credential) : null;
  const pathId = c.req.param("id");
  if (!credential || !parsed || parsed.id !== pathId || !allowAttempt(pathId)) {
    return c.json({ error: "Enrollment unavailable." }, 404);
  }

  const completed = await completeNodeEnrollment(credential);
  if (!completed) {
    auditMachineAction(c, pathId, "node-enrollment.complete", "denied", "Enrollment unavailable.");
    return c.json({ error: "Enrollment unavailable." }, 404);
  }
  auditMachineAction(c, pathId, "node-enrollment.complete", "success");
  return c.json({ completed: true });
}
