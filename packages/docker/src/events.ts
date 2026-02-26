import { createLogger } from "@otterdeploy/logger";

import { getDockerClient } from "./client";

const log = createLogger("docker:events");

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

export interface ContainerDeathEvent {
  containerId: string;
  action: "die" | "stop" | "kill";
  serviceName: string;
  time: number;
}

export type ContainerDeathCallback = (event: ContainerDeathEvent) => void;

export function watchContainerEvents(callback: ContainerDeathCallback): {
  stop: () => void;
} {
  let stream: NodeJS.ReadableStream | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let stopped = false;

  function cleanup() {
    if (stream) {
      try {
        stream.removeAllListeners();
        if (typeof (stream as any).destroy === "function") {
          (stream as any).destroy();
        }
      } catch {
        // ignore cleanup errors
      }
      stream = null;
    }
  }

  function scheduleReconnect() {
    if (stopped) return;

    log.info({ backoffMs }, "Scheduling event stream reconnect");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoffMs);

    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }

  function connect() {
    if (stopped) return;

    const docker = getDockerClient();

    docker.getEvents(
      {
        filters: {
          type: ["container"],
          event: ["die", "stop", "kill"],
        },
      },
      (err, eventStream) => {
        if (stopped) {
          if (eventStream) {
            try {
              eventStream.removeAllListeners();
              if (typeof (eventStream as any).destroy === "function") {
                (eventStream as any).destroy();
              }
            } catch {
              // ignore
            }
          }
          return;
        }

        if (err || !eventStream) {
          log.error(
            { err },
            "Failed to connect to Docker event stream",
          );
          scheduleReconnect();
          return;
        }

        stream = eventStream;
        backoffMs = INITIAL_BACKOFF_MS;
        log.info("Connected to Docker event stream");

        eventStream.on("data", (chunk: Buffer) => {
          let event: ContainerDeathEvent;
          try {
            const raw = JSON.parse(chunk.toString("utf8"));

            const action = raw.Action as string | undefined;
            if (action !== "die" && action !== "stop" && action !== "kill") {
              return;
            }

            const attributes = raw.Actor?.Attributes as
              | Record<string, string>
              | undefined;
            const serviceName =
              attributes?.["com.docker.swarm.service.name"];

            if (!serviceName || !serviceName.startsWith("otterstack-")) {
              return;
            }

            event = {
              containerId: raw.Actor?.ID ?? raw.id ?? "",
              action,
              serviceName,
              time: raw.time ?? Math.floor(Date.now() / 1000),
            };
          } catch (parseErr) {
            log.warn({ err: parseErr }, "Failed to parse Docker event");
            return;
          }

          try {
            callback(event);
          } catch (callbackErr) {
            log.error({ err: callbackErr, event }, "Event callback threw an error");
          }
        });

        eventStream.on("error", (streamErr: Error) => {
          log.error({ err: streamErr }, "Docker event stream error");
          cleanup();
          scheduleReconnect();
        });

        eventStream.on("end", () => {
          log.info("Docker event stream ended");
          cleanup();
          scheduleReconnect();
        });
      },
    );
  }

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      cleanup();
      log.info("Docker event watcher stopped");
    },
  };
}
