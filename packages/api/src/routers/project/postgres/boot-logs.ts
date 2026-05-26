/**
 * Container boot-log tail helper.
 *
 * Resolves the swarm service's running container, attaches to its log
 * stream, and yields one event per stdout/stderr line until either the
 * `readyPattern` matches or `timeoutMs` elapses. Used by
 * createPostgresResourceStream to show postgres' own startup messages
 * (initdb output, "ready to accept connections") in the wizard.
 */

import { Docker } from "@otterdeploy/docker";

export interface BootLogEvent {
  stream: "stdout" | "stderr";
  line: string;
}

async function resolveServiceContainerId(
  docker: Docker,
  serviceName: string,
): Promise<string | null> {
  const tasksResult = await docker.tasks.list({ filters: { service: [serviceName] } });
  if (tasksResult.isErr()) return null;
  const running = tasksResult.value.find(
    (t) => (t as { Status?: { State?: string } }).Status?.State === "running",
  );
  return (
    (
      running as
        | { Status?: { ContainerStatus?: { ContainerID?: string } } }
        | undefined
    )?.Status?.ContainerStatus?.ContainerID ?? null
  );
}

// Parse docker's 8-byte multiplexed log framing and yield whole lines.
// Buffers partial frames + partial lines across chunks so the consumer
// never sees byte fragments. Mirrors the demuxer in resource-logs.ts but
// kept inline so this file owns its own boot-log behavior.
async function* demuxBootLogs(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<BootLogEvent, void, void> {
  let buffer = Buffer.alloc(0);
  const partial: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const streamByte = buffer[0];
      const payloadLen = buffer.readUInt32BE(4);
      if (buffer.length < 8 + payloadLen) break;
      const payload = buffer.subarray(8, 8 + payloadLen).toString("utf8");
      buffer = buffer.subarray(8 + payloadLen);
      const which: "stdout" | "stderr" = streamByte === 2 ? "stderr" : "stdout";
      const combined = partial[which] + payload;
      const lines = combined.split("\n");
      partial[which] = lines[lines.length - 1] ?? "";
      for (let i = 0; i < lines.length - 1; i++) {
        const raw = lines[i] ?? "";
        if (raw.length > 0) yield { stream: which, line: raw };
      }
    }
  }
  for (const which of ["stdout", "stderr"] as const) {
    if (partial[which].length > 0) yield { stream: which, line: partial[which] };
  }
}

export async function* tailContainerBootLogs(input: {
  serviceName: string;
  timeoutMs: number;
  readyPattern: RegExp;
}): AsyncGenerator<BootLogEvent, void, void> {
  const docker = Docker.fromEnv();
  try {
    // Poll briefly for the container id — swarm may have just placed the
    // task and the container record might not be queryable for a beat.
    let containerId: string | null = null;
    const deadlineForResolve = Date.now() + 3_000;
    while (!containerId && Date.now() < deadlineForResolve) {
      containerId = await resolveServiceContainerId(docker, input.serviceName);
      if (!containerId) await new Promise((r) => setTimeout(r, 250));
    }
    if (!containerId) return;

    const logsResult = await docker.containers.getContainer(containerId).logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: "100",
    });
    if (logsResult.isErr()) throw logsResult.error;

    const deadline = Date.now() + input.timeoutMs;
    const stream = logsResult.value as NodeJS.ReadableStream & {
      destroy?: () => void;
    };
    const closeStream = () => {
      try {
        stream.destroy?.();
      } catch {
        // best-effort — the demuxer's for-await will end either way.
      }
    };

    // Race the demuxer against the deadline. When the deadline hits, we
    // destroy the underlying stream which ends the for-await loop cleanly.
    const timer = setTimeout(closeStream, input.timeoutMs);
    try {
      for await (const event of demuxBootLogs(stream)) {
        yield event;
        if (input.readyPattern.test(event.line)) {
          closeStream();
          return;
        }
        if (Date.now() >= deadline) {
          closeStream();
          return;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } finally {
    docker.destroy();
  }
}
