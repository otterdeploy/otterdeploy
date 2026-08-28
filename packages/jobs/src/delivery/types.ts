/**
 * The shapes every transport speaks: what a resolved channel is, what an event
 * looks like on the way out, and what a delivery reports back.
 *
 * Their own module so that ./channels.ts (the dispatcher) and
 * ./chat-transports.ts can both depend on them without depending on each other.
 * An `import type` cycle is erased at compile time, but the repo tracks import
 * cycles as a real measure, so the dependency is broken properly rather than
 * relying on erasure.
 */

import type { JsonObject } from "@otterdeploy/shared/json";

import type { Severity } from "./message";

export type ChannelKind =
  | "slack"
  | "discord"
  | "email"
  | "webhook"
  | "telegram"
  | "pagerduty"
  | "push";

export interface ResolvedChannel {
  id: string;
  kind: ChannelKind;
  name: string;
  target: string;
  /** Free-form provider config (jsonb-backed; shape varies by `kind`). */
  config: JsonObject;
  /** Decrypted secret (bot token / HMAC key / routing key), or null. */
  secret: string | null;
}

export interface ChannelEvent {
  eventId: string;
  /** Severity hint for providers that style by level. One definition, in
   *  ./message.ts, so the badge table and this union cannot drift apart. */
  severity: Severity;
  title: string;
  message: string;
  /** Display context (already-formatted strings) shown as key/value rows. */
  data?: Record<string, string>;
  /** Deep link to the page that explains the event. Optional and additive:
   *  no emitter passes one yet, and transports fall back to the app root. */
  url?: string;
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
}
