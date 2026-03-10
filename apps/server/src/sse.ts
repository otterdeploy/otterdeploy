import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

export function createSSEHandler() {
  return async (c: Context) => {
    return streamSSE(c, async (stream) => {
      // Placeholder: will connect to Postgres LISTEN/NOTIFY in Phase 2+
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ status: "ok" }),
      });

      // Keep connection alive with heartbeat
      const interval = setInterval(async () => {
        try {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
        } catch {
          clearInterval(interval);
        }
      }, 30_000);

      stream.onAbort(() => {
        clearInterval(interval);
      });
    });
  };
}
