/**
 * GitHub rate-limit detection for the repo-inspection REST fallback.
 */

/**
 * Minimal response shape shared by both the real DOM `Response` and
 * `ghFetch`'s egress-policy-wrapped return value. Just enough for the
 * rate-limit checks below, so callers on either side of the SSRF-hardened
 * `ghFetch` migration can use these helpers unchanged.
 */
interface RateLimitResponseLike {
  status: number;
  headers: { get(name: string): string | null };
}

/**
 * Detect a GitHub rate-limit response. The strongest signal is the
 * `X-RateLimit-Remaining: 0` header on a 403; we fall back to a body
 * substring match for older edge cases.
 */
export function isRateLimited(res: RateLimitResponseLike, body: string): boolean {
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (remaining === "0") return true;
    if (body.toLowerCase().includes("api rate limit exceeded")) return true;
    if (body.toLowerCase().includes("secondary rate limit")) return true;
  }
  return false;
}

export function rateLimitReset(res: RateLimitResponseLike): number | null {
  const v = res.headers.get("X-RateLimit-Reset");
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
