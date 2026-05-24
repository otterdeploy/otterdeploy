/**
 * Bridge between evlog's two logger shapes.
 *
 * Helpers in swarm/caddy/docker run from both request paths (where a
 * `RequestLogger` exists and step events should accumulate on the request's
 * wide event) and from bootstrap (where they should emit standalone events
 * via the global logger). The two APIs aren't substitutable —
 *   - `globalLog.info({ event })` — object overload
 *   - `RequestLogger.info(message, context?)` — message-first
 *
 * `asStepLogger` returns a tiny adapter with a single object-first call shape.
 * When backed by a `RequestLogger`, each call appends to a `steps[]` array on
 * the wide event (evlog's `set` concatenates array values, so repeated calls
 * accumulate). When backed by the global logger, each call emits a standalone
 * event.
 */

import { log as globalLog, type RequestLogger } from "evlog";

export type StepLogger = {
  info(event: Record<string, unknown>): void;
  warn(event: Record<string, unknown>): void;
  error(eventOrError: Record<string, unknown> | Error): void;
};

export function asStepLogger(log?: RequestLogger): StepLogger {
  if (!log) {
    return {
      info: (event) => globalLog.info(event),
      warn: (event) => globalLog.warn(event),
      error: (e) => {
        if (e instanceof Error) {
          globalLog.error({ error: { message: e.message, stack: e.stack } });
        } else {
          globalLog.error(e);
        }
      },
    };
  }
  return {
    info: (event) => log.set({ steps: [{ level: "info", ...event }] }),
    warn: (event) => log.set({ steps: [{ level: "warn", ...event }] }),
    error: (e) => {
      if (e instanceof Error) log.error(e);
      else log.set({ steps: [{ level: "error", ...e }] });
    },
  };
}
