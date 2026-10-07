/**
 * Ordinary dashboard browsing must never trip the auth rate limit.
 *
 * The dashboard reads the caller's own session (`get-session`,
 * `organization/list`) on every route change and full page load. Those reads
 * shared the 100-a-minute per-IP default with sign-in, so a quick operator (or
 * a team behind one NAT) hit 429 and the app showed a full-screen error.
 *
 * Driven through the REAL configured better-auth handler (its own limiter, its
 * own IP resolution from `x-forwarded-for`), one client IP per test so the
 * buckets do not interfere. Rate limiting runs before any handler, so no
 * session or database is needed to observe it.
 */
import { auth } from "@otterdeploy/auth";
import {
  AUTH_RATE_LIMIT_MAX_REQUESTS,
  SESSION_READ_RATE_LIMIT_MAX_REQUESTS,
} from "@otterdeploy/auth/rate-limit";
import { describe, expect, it } from "vite-plus/test";

const RATE_LIMITED = 429;

/** Statuses of `count` sequential GETs to an auth path from one client IP. */
async function statuses(path: string, ip: string, count: number): Promise<number[]> {
  const seen: number[] = [];
  for (let i = 0; i < count; i++) {
    const response = await auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        headers: { "x-forwarded-for": ip, origin: "http://localhost:3000" },
      }),
    );
    seen.push(response.status);
  }
  return seen;
}

describe("session reads have their own, larger rate-limit bucket", () => {
  it("well past the default budget, get-session and organization/list are still answered", async () => {
    const burst = AUTH_RATE_LIMIT_MAX_REQUESTS + 50;
    for (const path of ["/get-session", "/organization/list"]) {
      const seen = await statuses(path, "203.0.113.73", burst);
      expect(
        seen.filter((status) => status === RATE_LIMITED),
        path,
      ).toEqual([]);
    }
  });

  it("the session-read bucket is still bounded", async () => {
    const seen = await statuses(
      "/get-session",
      "203.0.113.74",
      SESSION_READ_RATE_LIMIT_MAX_REQUESTS + 1,
    );
    expect(seen.at(-1)).toBe(RATE_LIMITED);
    expect(seen.slice(0, -1).filter((status) => status === RATE_LIMITED)).toEqual([]);
  });

  it("a lookup-by-id endpoint keeps the default budget", async () => {
    const seen = await statuses(
      "/organization/get-invitation?id=inv_probe",
      "203.0.113.75",
      AUTH_RATE_LIMIT_MAX_REQUESTS + 1,
    );
    expect(seen.at(-1)).toBe(RATE_LIMITED);
  });
});
