/**
 * Webhooks feature — outbound signed-event POSTs + inbound trigger endpoints.
 * Types are inferred straight from the oRPC contract via the collections so
 * the UI can't drift from the server. The event vocabulary is the SAME
 * catalog notifications uses — import EVENTS from that feature, never fork it.
 */
import { env } from "@otterdeploy/env/web";

import type { inboundCollection, outboundCollection } from "./data/webhooks";

export type OutboundWebhook = (typeof outboundCollection.toArray)[number];
export type InboundEndpoint = (typeof inboundCollection.toArray)[number];
export type OutboundStatus = OutboundWebhook["status"];
export type InboundStatus = InboundEndpoint["status"];

/** Public URL an inbound endpoint listens on. The SPA and the API share an
 * origin in production; in dev VITE_SERVER_URL points at the API server. */
export function inboundUrl(token: string): string {
  return `${env.VITE_SERVER_URL}/api/webhooks/in/${token}`;
}

/** Hostname of a URL for compact display; falls back to the raw string. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Status pill meta shared by both card kinds. */
export const STATUS_META: Record<OutboundStatus | InboundStatus, { label: string; dot: string }> = {
  active: { label: "active", dot: "bg-emerald-500" },
  paused: { label: "paused", dot: "bg-muted-foreground" },
  failing: { label: "failing", dot: "bg-red-500" },
};

/** Tone classes for an HTTP status-code badge in the deliveries table. */
export function codeTone(statusCode: number | null): string {
  if (statusCode === null) return "text-red-600 dark:text-red-500";
  if (statusCode < 300) return "text-emerald-600 dark:text-emerald-500";
  if (statusCode < 500) return "text-amber-600 dark:text-amber-500";
  return "text-red-600 dark:text-red-500";
}

/** curl invocation for the inbound success screen. The signature is over the
 * exact request body, so the snippet computes it inline with openssl. */
export function curlSnippet(url: string, secret: string): string {
  return [
    `BODY='{"event":"trigger"}'`,
    `SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "${secret}" | sed 's/^.* //')`,
    `curl -X POST ${url} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "X-Otterdeploy-Signature: sha256=$SIG" \\`,
    `  -d "$BODY"`,
  ].join("\n");
}
