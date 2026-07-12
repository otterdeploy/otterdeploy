/**
 * Display masking for notification-channel targets. The goal is *identity*,
 * not paranoia: the card and matrix should answer "WHICH inbox / room /
 * endpoint does this go to?" while never exposing a credential.
 *
 * Policy by kind:
 *   - email, telegram — the address / chat id is not a secret and IS the
 *     identity → shown in full.
 *   - slack, discord, webhook — the URL's origin + path are identity; any
 *     token-looking path segment (Slack webhook tokens, Discord webhook
 *     tokens) and secret-ish query values are masked in place.
 *   - pagerduty, push — the target may BE the credential (Events API routing
 *     key, FCM device token) → masked down to the last 4 characters.
 */

export type MaskableKind =
  | "slack"
  | "discord"
  | "email"
  | "webhook"
  | "telegram"
  | "pagerduty"
  | "push";

const MASK = "••••";

/** A path segment that looks like a credential: long, dense base64url-ish.
 * Slack webhook tokens (24) and Discord webhook tokens (68) match; short
 * workspace/channel ids (T0…/B0…, ~10 chars) stay visible as identity. */
const TOKEN_SEGMENT_RE = /^[A-Za-z0-9_-]{20,}$/;

/** Query keys that carry a secret regardless of the value's shape. */
const SECRET_QUERY_KEY_RE = /token|secret|key|sig|signature|auth|password|passwd|code/i;

/** Query values that look like credentials even under a benign key. */
const TOKEN_QUERY_VALUE_RE = /^[A-Za-z0-9_\-.=%]{16,}$/;

/** Mask token-looking parts of a webhook-style URL, keep origin + path shape. */
function maskUrl(target: string): string {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return maskOpaque(target);
  }
  // Non-http schemes (mailto:, queue:, …) have no meaningful origin/path
  // split — treat them as opaque strings.
  if (url.protocol !== "http:" && url.protocol !== "https:") return maskOpaque(target);
  const path = url.pathname
    .split("/")
    .map((seg) => (TOKEN_SEGMENT_RE.test(seg) ? MASK : seg))
    .join("/");
  const params: string[] = [];
  for (const [k, v] of url.searchParams) {
    const hide = SECRET_QUERY_KEY_RE.test(k) || TOKEN_QUERY_VALUE_RE.test(v);
    params.push(`${k}=${hide ? MASK : v}`);
  }
  return `${url.origin}${path}${params.length > 0 ? `?${params.join("&")}` : ""}`;
}

/** Fallback for a non-URL value we can't classify: identifying head only. */
function maskOpaque(target: string): string {
  if (target.length <= 8) return target;
  return `${target.slice(0, 8)}${MASK}`;
}

/** Credential-like target (routing key, device token): last 4 chars only. */
function maskCredential(target: string): string {
  if (target.length <= 4) return MASK;
  return `${MASK}${target.slice(-4)}`;
}

/** Mask a channel destination for display, per the kind policy above. */
export function maskChannelTarget(kind: MaskableKind, target: string): string {
  switch (kind) {
    case "email":
    case "telegram":
      return target;
    case "slack":
    case "discord":
    case "webhook":
      return maskUrl(target);
    case "pagerduty":
    case "push":
      return maskCredential(target);
  }
}
