/**
 * Shared parsers for the raw streams docker hands us.
 *
 * Every docker stream consumer used to hand-roll its own framing/line
 * buffering — the 8-byte multiplex demuxer lived in both resource-logs and
 * boot-logs, and newline-JSON reading was reimplemented in image-pull and
 * the event-bus drain. These are the single canonical versions:
 *
 *   - `demuxDockerStream`   — 8-byte multiplexed container/service log frames
 *   - `splitDockerTimestamp`— peel the ISO ts docker prepends (timestamps=true)
 *   - `readNdjson`          — newline-delimited JSON (image pull, `/events`)
 *   - `readLines`           — newline-delimited raw lines
 */

export interface DockerLogChunk {
  stream: "stdout" | "stderr";
  line: string;
}

/**
 * Demux docker's multiplexed log framing into whole lines.
 *
 * Framing (TTY=false, our case for swarm services):
 *   - 8-byte header per chunk:
 *     - byte 0: stream type (0=stdin, 1=stdout, 2=stderr)
 *     - bytes 1-3: reserved
 *     - bytes 4-7: payload length (big-endian uint32)
 *   - N bytes of payload
 *
 * Buffers partial frames + partial lines across chunks so the consumer
 * always sees whole lines, never byte fragments.
 */
export async function* demuxDockerStream(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<DockerLogChunk, void, void> {
  let buffer = Buffer.alloc(0);
  const partial: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 8) {
      const streamByte = buffer[0];
      const payloadLen = buffer.readUInt32BE(4);
      if (buffer.length < 8 + payloadLen) break; // wait for more data

      const payload = buffer.subarray(8, 8 + payloadLen).toString("utf8");
      buffer = buffer.subarray(8 + payloadLen);

      const which: "stdout" | "stderr" = streamByte === 2 ? "stderr" : "stdout";

      const combined = partial[which] + payload;
      const lines = combined.split("\n");
      // Last entry may be a partial line — stash it for the next chunk.
      const lastIdx = lines.length - 1;
      partial[which] = lines[lastIdx] ?? "";
      for (let i = 0; i < lastIdx; i++) {
        const raw = lines[i] ?? "";
        if (raw.length === 0) continue;
        yield { stream: which, line: raw };
      }
    }
  }

  // Final flush of any trailing partials.
  for (const which of ["stdout", "stderr"] as const) {
    if (partial[which].length > 0) {
      yield { stream: which, line: partial[which] };
    }
  }
}

/**
 * Strip a leading ISO-8601 timestamp docker prepends when `timestamps=true`.
 * Format: `2026-05-26T12:34:56.789Z some log line`. Returns `ts: null` and
 * the line untouched when the first token isn't an ISO date.
 */
export function splitDockerTimestamp(raw: string): {
  ts: string | null;
  line: string;
} {
  const match = /^(\S+)\s(.*)$/.exec(raw);
  if (match && /^\d{4}-\d{2}-\d{2}T/.test(match[1] ?? "")) {
    return { ts: match[1] ?? null, line: match[2] ?? raw };
  }
  return { ts: null, line: raw };
}

/**
 * Read a newline-delimited stream and yield each non-empty, trimmed line.
 * Buffers partial lines across chunks; flushes a trailing partial at EOF.
 */
export async function* readLines(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<string, void, void> {
  let buffer = "";
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const raw = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (raw.length > 0) yield raw;
      nl = buffer.indexOf("\n");
    }
  }
  const tail = buffer.trim();
  if (tail.length > 0) yield tail;
}

/**
 * Read a newline-delimited JSON stream and yield each parsed object.
 * Unparseable lines are skipped — docker occasionally batches multiple JSON
 * objects on a line or emits status noise we don't care about.
 */
export async function* readNdjson<T>(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<T, void, void> {
  for await (const line of readLines(stream)) {
    try {
      yield JSON.parse(line) as T;
    } catch {
      // skip unparseable line
    }
  }
}
