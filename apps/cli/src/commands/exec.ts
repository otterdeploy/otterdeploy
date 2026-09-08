import { ORPCError } from "@orpc/client";
import { Result } from "better-result";
import { defineCommand } from "citty";
import * as z from "zod";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { type CliClient, resolveResource } from "../lib/resolve";
import { abort, dim, note, ok, secret, warn } from "../lib/ui";

type TerminalTargets = Awaited<ReturnType<CliClient["terminal"]["targets"]>>;
type TerminalContainer = TerminalTargets["containers"][number];

// Mirrors the server's ServerMessage schema (apps/server/src/messages.ts):
// text frames are JSON control messages, binary frames are raw PTY bytes.
type ServerMessage =
  | { type: "session:exit"; exitCode: number | null; signal: string | null }
  | { type: "error"; code: string; message: string };

const serverMessageSchema: z.ZodType<ServerMessage> = z.union([
  z.object({
    type: z.literal("session:exit"),
    exitCode: z.number().nullable(),
    signal: z.string().nullable(),
  }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);

function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const parsed = serverMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function wsBase(url: string): string {
  return url.replace(/\/$/, "").replace(/^http/, "ws");
}

function pickContainer(
  matches: TerminalContainer[],
  replica: string | undefined,
  serviceName: string,
): TerminalContainer {
  if (replica) {
    const exact = matches.find((c) => c.replicaSlot === replica);
    if (!exact) {
      const slots = matches.map((c) => c.replicaSlot ?? "?").join(", ");
      abort(
        `No running replica ${replica} for ${serviceName}.`,
        slots === "" ? "nothing is running" : `running slots: ${slots}`,
      );
    }
    return exact;
  }
  const picked = matches.find((c) => c.replicaSlot === "1") ?? matches[0];
  if (!picked) {
    abort(`No running containers for ${serviceName}.`);
  }
  if (matches.length > 1) {
    const others = matches
      .filter((c) => c !== picked)
      .map((c) => c.replicaSlot ?? c.containerId.slice(0, 12))
      .join(", ");
    // Attaching to an arbitrary replica silently would hide which one you are
    // looking at, so name the choice and how to override it.
    note(`${matches.length} replicas running. Attaching to slot ${picked.replicaSlot ?? "?"}.`);
    note(dim(`Others: ${others}. Pick one with --replica <slot>.`));
  }
  return picked;
}

// od-5j8.9: /pty no longer accepts a bearer token in the query string. The
// WS upgrade authenticates from a single-use, target-bound ticket instead
// (see packages/api/src/routers/terminal/{contract,index,tickets}.ts). The
// CLI mints one through the same authenticated RPC the web app uses, which
// requires a recent step-up (password or TOTP, whichever the account uses).
// `performStepUp` probes which one via the server's own error code rather
// than guessing.
type ShellTarget = { kind: "container"; containerId: string } | { kind: "host" };

async function performStepUp(client: CliClient): Promise<void> {
  try {
    // Deliberately empty: the server rejects with exactly the field it
    // needs (TWO_FACTOR_CODE_REQUIRED or PASSWORD_REQUIRED), so this probes
    // the account's auth method instead of guessing it client-side.
    await client.terminal.stepUp({});
  } catch (err) {
    if (!(err instanceof ORPCError)) throw err;
    if (err.code === "TWO_FACTOR_CODE_REQUIRED") {
      const code = await secret("Authenticator code");
      if (code === null) abort("Step-up cancelled. No shell was opened.");
      await client.terminal.stepUp({ totpCode: code.trim() });
      return;
    }
    if (err.code === "PASSWORD_REQUIRED") {
      // `secret` reads raw bytes and echoes nothing, so the password never
      // reaches the terminal or its scrollback.
      const password = await secret("Password");
      if (password === null) abort("Step-up cancelled. No shell was opened.");
      await client.terminal.stepUp({ password });
      return;
    }
    if (err.code === "STEP_UP_UNAVAILABLE") {
      // There is no credential to prompt for. Prompting anyway is what this
      // used to do — an invited, passkey-only or social account was shown
      // "Password:" for a password it does not have, and every attempt failed
      // identically with nothing to try differently (od-rvca). The server's
      // message names the two ways out, so it is printed rather than
      // paraphrased.
      abort(err.message);
    }
    throw err;
  }
}

async function mintTicket(client: CliClient, target: ShellTarget): Promise<string> {
  try {
    return (await client.terminal.mintTicket({ target })).ticket;
  } catch (err) {
    if (err instanceof ORPCError && err.code === "STEP_UP_REQUIRED") {
      await performStepUp(client);
      return (await client.terminal.mintTicket({ target })).ticket;
    }
    throw err;
  }
}

// Attach the local TTY to the /pty WebSocket. Wire protocol: binary frames
// are raw PTY bytes both ways; text frames are JSON control messages. Never
// resolves. Every exit path goes through restoreTty + process.exit.
/**
 * Why did the upgrade fail?
 *
 * A WebSocket `error` event is deliberately opaque — no status, no body, so a
 * browser cannot probe cross-origin endpoints through it. That is right for a
 * browser and useless in a CLI, where the server's own message is the only
 * thing that would tell the operator what to do.
 *
 * So ask again over plain HTTP, WITHOUT a ticket. The server checks origin
 * before the ticket, so an origin rejection answers 403 with its reason, while
 * anything else answers 401 "Missing ticket" — which tells us the upgrade got
 * past the gates and the failure lies elsewhere, and is not worth repeating to
 * the operator as though it were the cause.
 *
 * Omitting the ticket is what makes this safe to run: the real one is
 * single-use, and spending it on a diagnostic would turn a recoverable failure
 * into a definitely-unrecoverable one.
 *
 * Returns null when it learns nothing, so the caller keeps its generic message
 * rather than inventing a cause.
 */
async function explainUpgradeFailure(wsUrl: string): Promise<string | null> {
  const probe = new URL(wsUrl);
  probe.protocol = probe.protocol === "wss:" ? "https:" : "http:";
  probe.searchParams.delete("ticket");

  const response = await Result.tryPromise({
    try: () =>
      fetch(probe, {
        headers: { upgrade: "websocket", connection: "Upgrade" },
      }),
    catch: (cause) => cause,
  });
  if (response.isErr()) return null;
  // 401 means the gates passed and only the (deliberately omitted) ticket was
  // missing. Reporting that would name the probe's own omission as the cause.
  if (response.value.status === 401) return null;

  const body = await Result.tryPromise({
    try: () => response.value.json(),
    catch: (cause) => cause,
  });
  if (body.isErr()) return null;
  const message =
    typeof body.value === "object" && body.value !== null && "message" in body.value
      ? body.value.message
      : null;
  return typeof message === "string" && message.length > 0
    ? `Could not open the shell connection: ${message} (HTTP ${response.value.status}).`
    : null;
}

function attach(wsUrl: string): Promise<never> {
  return new Promise<never>(() => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    const sendResize = (): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "session:resize",
          cols: process.stdout.columns || 80,
          rows: process.stdout.rows || 24,
        }),
      );
    };

    const onStdin = (chunk: Buffer): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(new Uint8Array(chunk));
    };

    let restored = false;
    const restoreTty = (): void => {
      if (restored) return;
      restored = true;
      process.stdin.off("data", onStdin);
      process.off("SIGWINCH", sendResize);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    // Raw mode must never outlive the process, whatever the exit path.
    process.once("exit", restoreTty);

    ws.addEventListener("open", () => {
      // Server defaults to 80x24 and only resizes on this message.
      sendResize();
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", onStdin);
      process.on("SIGWINCH", sendResize);
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data === "string") {
        const msg = parseServerMessage(data);
        if (!msg) return;
        restoreTty();
        process.stdout.write("\n");
        if (msg.type === "session:exit") {
          if (msg.exitCode === 0) ok("Shell exited.");
          else if (msg.exitCode !== null) note(`Shell exited with code ${msg.exitCode}.`);
          else if (msg.signal) note(`Shell exited on signal ${msg.signal}.`);
          else note("Shell session ended.");
          process.exit(msg.exitCode ?? 0);
        }
        abort(`${msg.code}: ${msg.message}`);
      }
      if (data instanceof ArrayBuffer) process.stdout.write(new Uint8Array(data));
    });

    ws.addEventListener("close", (event: CloseEvent) => {
      if (restored) return; // already handled by session:exit / error
      restoreTty();
      process.stdout.write("\n");
      if (event.code === 1000) process.exit(0);
      abort(`Connection closed unexpectedly (code ${event.code}).`);
    });

    ws.addEventListener("error", () => {
      if (restored) return;
      restoreTty();
      // The WHATWG error event carries no status and no body, so the server's
      // actual reason is unreachable from here. That is how a hard 403 ("Origin
      // not allowed", od-v7wb) surfaced for weeks as a bare "could not open",
      // with nothing to act on. Ask the endpoint directly for the reason.
      void explainUpgradeFailure(wsUrl).then((reason) =>
        abort(reason ?? "Could not open the shell connection."),
      );
    });
  });
}

export const execCommand = defineCommand({
  meta: {
    name: "exec",
    description: "Open an interactive shell in a running service container",
  },
  args: {
    service: { type: "positional", required: false, description: "Service name" },
    replica: { type: "string", description: "Replica slot to attach to (e.g. 1)" },
    host: { type: "boolean", description: "Open a shell on the control-plane host instead" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
  },
  async run({ args }) {
    if (!process.stdin.isTTY) {
      abort("`exec` needs an interactive terminal.", "it cannot run in CI or through a pipe");
    }
    // Global WebSocket is available under Bun and Node ≥22.
    if (typeof WebSocket === "undefined") {
      abort("`exec` needs a WebSocket runtime.", "run it under Bun, or Node 22 or newer");
    }
    const { url, token } = await ensureAuthenticated(args.url);

    if (args.host) {
      const client = createCliClient({ url, token });
      warn("This opens a shell on the control-plane machine itself.");
      note("Connecting…");
      const ticket = await mintTicket(client, { kind: "host" });
      return attach(`${wsBase(url)}/pty?ticket=${encodeURIComponent(ticket)}`);
    }

    const ctx = await resolveResource(args, args.service, "service");
    const targets = await ctx.client.terminal.targets({});
    const matches = targets.containers.filter((c) => c.serviceResourceId === ctx.resourceId);
    if (matches.length === 0) {
      abort(`No running containers for ${ctx.resourceName}.`);
    }
    const picked = pickContainer(matches, args.replica, ctx.resourceName);

    const slot = picked.replicaSlot ? ` (replica ${picked.replicaSlot})` : "";
    note(`Connecting to ${ctx.resourceName}${slot}…`);
    const ticket = await mintTicket(ctx.client, {
      kind: "container",
      containerId: picked.containerId,
    });
    return attach(`${wsBase(url)}/pty?ticket=${encodeURIComponent(ticket)}`);
  },
});
