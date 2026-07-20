/**
 * Rewrite the device-flow verification URLs onto the canonical control-plane
 * origin.
 *
 * WHY THIS EXISTS: better-auth's deviceAuthorization plugin types
 * `verificationUri` as `z.string().optional()` — a plain string, read once when
 * the plugin is constructed (see packages/auth/src/index.ts). It cannot be a
 * callback, so the URL it hands the CLI is frozen at module load from
 * `CORS_ORIGIN[0] ?? BETTER_AUTH_URL`. On a default install those are
 * `http://<server-ip>:3000` (scripts/install.sh), so the operator copies
 * `otterdeploy login https://deploy.acme.com` out of the dashboard and the CLI
 * then sends them to `http://1.2.3.4:3000/device` to approve it — a different
 * origin, over plain http, with a port. A domain verified *after* boot never
 * shows up at all until the process restarts.
 *
 * So we fix it on the way out: the plugin still builds the URLs, and this
 * swaps their origin for `resolveCanonicalWebOrigin()` — the verified
 * control-plane FQDN when one exists, otherwise exactly what it returns today.
 * Path, query (`user_code`) and every other field are preserved.
 *
 * Only `POST /api/auth/device/code` carries these fields; every other auth
 * route passes straight through untouched.
 */

import { resolveCanonicalWebOrigin } from "@otterdeploy/auth/web-origin";
import { log } from "evlog";

/** The one route whose body carries verification URLs. */
const DEVICE_CODE_PATH = "/api/auth/device/code";

/** Fields better-auth populates with an absolute verification URL. */
const URI_FIELDS = ["verification_uri", "verification_uri_complete"] as const;

/** Swap `raw`'s origin for `origin`, keeping path + query. Returns the input
 *  unchanged if it isn't a parseable absolute URL (nothing to rebase). */
function rebaseOrigin(raw: unknown, origin: string): unknown {
  if (typeof raw !== "string" || raw.length === 0) return raw;
  try {
    const next = new URL(raw);
    const target = new URL(origin);
    next.protocol = target.protocol;
    next.hostname = target.hostname;
    // Assign the port explicitly: the `host` setter leaves an existing port in
    // place when the new value carries none, so rebasing `:3000` onto a bare
    // domain would silently keep the port. `""` clears it.
    next.port = target.port;
    return next.toString();
  } catch {
    return raw;
  }
}

/**
 * Given the request path and better-auth's response, return a response whose
 * verification URLs point at the canonical control-plane origin. Never throws:
 * on any failure the original response is returned, because a login that sends
 * the user to a stale-but-working origin beats a login that 500s.
 */
export async function withCanonicalDeviceOrigin(path: string, res: Response): Promise<Response> {
  if (path !== DEVICE_CODE_PATH || !res.ok) return res;
  if (!res.headers.get("content-type")?.includes("application/json")) return res;

  try {
    const body = (await res.clone().json()) as Record<string, unknown>;
    if (!URI_FIELDS.some((f) => typeof body[f] === "string")) return res;

    const origin = await resolveCanonicalWebOrigin();
    const rewritten = { ...body };
    for (const field of URI_FIELDS) {
      rewritten[field] = rebaseOrigin(body[field], origin);
    }

    // Preserve the plugin's headers (notably `Cache-Control: no-store`).
    return new Response(JSON.stringify(rewritten), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } catch (error) {
    log.warn({
      deviceAuth: {
        status: "verification-uri-rewrite-failed",
        detail: error instanceof Error ? error.message : String(error),
      },
    });
    return res;
  }
}
