/**
 * Which subscriptions an event reaches.
 *
 * A subscription names one catalog event, but some events are a narrower kind
 * of another. A push whose build fails never reaches a rollout, so the builder
 * raises `build.failed` and never `deploy.failed` (that one is raised by the
 * runtime/rollout path). To the operator who routed "Deploy failed" to the
 * on-call channel, a broken push IS a failed deploy, and it used to reach
 * nobody. So a `build.failed` event is also delivered to
 * channels and webhooks subscribed to `deploy.failed`.
 *
 * One event, one delivery per target: a channel subscribed to both ids gets the
 * event once (the fan-outs dedupe on the target), and the payload keeps its own
 * id and title ("Build failed"), so the message still says what broke.
 */
const ALSO_REACHES: Readonly<Record<string, readonly string[]>> = {
  "build.failed": ["deploy.failed"],
};

/** The subscription ids an event is delivered to: its own, then any it is a kind of. */
export function subscriberEventIds(eventId: string): string[] {
  return [eventId, ...(ALSO_REACHES[eventId] ?? [])];
}
