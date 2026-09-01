/**
 * A tunnel into a database container, for the length of a workbench session.
 *
 * A managed database is addressed by its alias on the project's network,
 * which only resolves for containers ON that network — and the control plane
 * is deliberately not one of them (docs/designs/workbench-managed-reach.md).
 * What the control plane does have is the Docker socket, and `docker exec`
 * reaches into any container it runs. So the wire driver keeps talking TCP,
 * to a loopback port here, and every connection it opens is carried by one
 * exec into the database's container, where a relay joins it to the database
 * on the container's own loopback.
 *
 * Nothing here is chosen by us: the kernel assigns the port (`port: 0`), the
 * listener binds 127.0.0.1 inside the control plane's own namespace, and the
 * relay's lifetime is the connection's. Closing the tunnel closes the
 * listener and every relay under it; nothing persists anywhere.
 */
import type { Subprocess } from "bun";

import { Result } from "better-result";

import { dataError, type DataError } from "./errors";

export interface Tunnel {
  host: "127.0.0.1";
  port: number;
  /** Relays currently open: one per pooled connection. */
  connections(): number;
  /** The last thing a relay wrote to stderr before exiting, for the reason
   *  line when the driver only saw "connection closed". */
  lastRelayError(): string | null;
  close(): void;
}

/**
 * The relay that runs INSIDE the database container, under its `/bin/sh`.
 * Stdin flows to the database, the database flows to stdout, and it exits as
 * soon as either side closes so a hung half-connection cannot outlive the
 * pooled connection it carried.
 *
 * Preference order is about streaming, not availability: `nc` and `socat`
 * forward each read at once; the bash form relies on `cat`, and BusyBox's
 * `cat` (Alpine) holds its output until EOF, which the driver never sends.
 * Alpine images ship `nc`; the Debian MariaDB image ships `socat`; the
 * MySQL image has only bash with GNU `cat`, which streams.
 */
export const RELAY_SCRIPT = `p="$1"
if command -v nc >/dev/null 2>&1; then
  exec nc 127.0.0.1 "$p"
elif command -v socat >/dev/null 2>&1; then
  exec socat - TCP:127.0.0.1:"$p"
elif command -v bash >/dev/null 2>&1; then
  exec bash -c '
    exec 3<>/dev/tcp/127.0.0.1/'"$p"' || exit 98
    exec 4<&0
    cat <&4 >&3 & w=$!
    cat <&3 & r=$!
    wait -n
    kill $w $r 2>/dev/null
  '
else
  echo "the database container has no nc, socat or bash, so nothing can relay into it" >&2
  exit 97
fi
`;

type Relay = Subprocess<"pipe", "pipe", "pipe">;

interface RelayState {
  proc: Relay | null;
  /** Resolves the writer waiting on backpressure once the socket drains. */
  drained: (() => void) | null;
}

/** Copy the relay's stdout onto the socket, honoring backpressure: a partial
 *  write parks the rest until `drain` fires, so a large result set cannot be
 *  truncated by a full socket buffer. */
async function pumpToSocket(
  proc: Relay,
  socket: Bun.Socket<RelayState>,
  state: RelayState,
): Promise<void> {
  for await (const chunk of proc.stdout) {
    let view: Uint8Array = chunk;
    while (view.byteLength > 0) {
      const written = socket.write(view);
      if (written >= view.byteLength) break;
      view = view.subarray(Math.max(written, 0));
      await new Promise<void>((resolve) => {
        state.drained = resolve;
      });
      if (state.proc === null) return;
    }
  }
}

async function readStderr(proc: Relay, onText: (text: string) => void): Promise<void> {
  const text = await Result.tryPromise({
    try: () => new Response(proc.stderr).text(),
    catch: () => undefined,
  });
  if (text.isOk() && text.value.trim().length > 0) onText(text.value.trim());
}

function endRelay(state: RelayState): void {
  const proc = state.proc;
  state.proc = null;
  state.drained?.();
  state.drained = null;
  if (proc === null) return;
  void Result.try({
    try: () => {
      void proc.stdin.end();
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  proc.kill();
}

export function openTunnel(input: {
  containerId: string;
  /** The database's port INSIDE its container. */
  port: number;
}): Result<Tunnel, DataError> {
  let open = 0;
  let lastError: string | null = null;
  const listen = Result.try({
    try: () =>
      Bun.listen<RelayState>({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open(socket) {
            open += 1;
            const proc = Bun.spawn(
              [
                "docker",
                "exec",
                "-i",
                input.containerId,
                "sh",
                "-c",
                RELAY_SCRIPT,
                "relay",
                String(input.port),
              ],
              { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
            );
            const state: RelayState = { proc, drained: null };
            socket.data = state;
            void readStderr(proc, (text) => {
              lastError = text;
            });
            void pumpToSocket(proc, socket, state).then(() => {
              endRelay(state);
              socket.end();
            });
            void proc.exited.then(() => {
              endRelay(state);
              socket.end();
            });
          },
          data(socket, chunk) {
            const proc = socket.data.proc;
            if (proc === null) return;
            void proc.stdin.write(chunk);
            void proc.stdin.flush();
          },
          drain(socket) {
            const resume = socket.data.drained;
            socket.data.drained = null;
            resume?.();
          },
          close(socket) {
            open -= 1;
            endRelay(socket.data);
          },
          error(socket) {
            endRelay(socket.data);
          },
        },
      }),
    catch: (cause) =>
      dataError(
        "unreachable",
        `could not open a loopback listener: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
  });
  if (listen.isErr()) return Result.err(listen.error);
  const listener = listen.value;
  return Result.ok({
    host: "127.0.0.1",
    port: listener.port,
    connections: () => open,
    lastRelayError: () => lastError,
    close: () => listener.stop(true),
  });
}
