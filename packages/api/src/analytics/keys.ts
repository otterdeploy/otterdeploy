/**
 * Public tracking keys for the web-analytics plane. The key is public by
 * design (it rides in the snippet, like a Plausible domain); the host
 * allowlist is the actual write guard, so this is an identifier mint, not a
 * secret mint — but it is still random so keys are unguessable and rotation
 * is meaningful. Design: docs/designs/web-analytics.md §2.
 */

import { randomBytes } from "node:crypto";

export const PUBLIC_KEY_RE = /^od_[0-9a-f]{32}$/;

export function mintPublicKey(): string {
  return `od_${randomBytes(16).toString("hex")}`;
}
