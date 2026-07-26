import { ORPCError } from "@orpc/client";
import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { type CliClient, resolveResource } from "../lib/resolve";

type TerminalTargets = Awaited<ReturnType<CliClient["terminal"]["targets"]>>;
type TerminalContainer = TerminalTargets["containers"][number];

// Mirrors the server's ServerMessage schema (apps/server/src/messages.ts):
// text frames are JSON control messages, binary frames are raw PTY bytes.
type ServerMessage =
  | { type: "session:exit"; exitCode: number | null; signal: string | null }
  | { type: "error"; code: string; message: string };

function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const msg = JSON.parse(raw) as ServerMessage;
    return msg.type === "session:exit" || msg.type === "error" ? msg : null;
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
      const slots = matches.map((c) => c.replicaSlot ?? "?").join(", ") || "(none)";
      consola.error(`No running replica ${replica} for ${serviceName}. Running slots: ${slots}`);
      process.exit(1);
    }
    return exact;
  }
  const picked = matches.find((c) => c.replicaSlot === "1") ?? matches[0];
  if (!picked) {
    consola.error(`No running containers for ${serviceName}.`);
    process.exit(1);
  }
  if (matches.length > 1) {
    const others = matches
      .filter((c) => c !== picked)
      .map((c) => c.replicaSlot ?? c.containerId.slice(0, 12))
      .join(", ");
    consola.info(
      `Multiple replicas running — attaching to slot ${picked.replicaSlot ?? "?"}. ` +
        `Others: ${others} (pick one with --replica <slot>).`,
    );
  }
  return picked;
}

// od-5j8.9: /pty no longer accepts a bearer token in the query string — the
// WS upgrade authenticates from a single-use, target-bound ticket instead
// (see packages/api/src/routers/terminal/{contract,index,tickets}.ts). The
// CLI mints one through the same authenticated RPC the web app uses, which
// requires a recent step-up (password or TOTP, whichever the account uses) —
// `performStepUp` probes which one via the server's own error code rather
// than guessing.
type ShellTarget = { kind: "container"; containerId: string } | { kind: "host" };

async function performStepUp(client: CliClient): Promise<void> {
  try {
    // Deliberately empty — the server rejects with exactly the field it
    // needs (TWO_FACTOR_CODE_REQUIRED or PASSWORD_REQUIRED), so this probes
    // the account's auth method instead of guessing it client-side.
    await client.terminal.stepUp({});
  } catch (err) {
    if (!(err instanceof ORPCError)) throw err;
    if (err.code === "TWO_FACTOR_CODE_REQUIRED") {
      const code = await consola.prompt("Authenticator code:", { type: "text" });
      await client.terminal.stepUp({ totpCode: String(code).trim() });
      return;
    }
    if (err.code === "PASSWORD_REQUIRED") {
      // consola has no masked/password prompt type — the terminal echoes
      // this. Acceptable for a locally-run CLI; TOTP is the masked-input-free
      // path for anyone who wants to avoid it (enable 2FA on the account).
      const password = await consola.prompt("Password:", { type: "text" });
      await client.terminal.stepUp({ password: String(password) });
      return;
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
// resolves — every exit path goes through restoreTty + process.exit.
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
          if (msg.exitCode !== null) consola.info(`Shell exited with code ${msg.exitCode}.`);
          else if (msg.signal) consola.info(`Shell exited (signal ${msg.signal}).`);
          else consola.info("Shell session ended.");
          process.exit(msg.exitCode ?? 0);
        }
        consola.error(`${msg.code}: ${msg.message}`);
        process.exit(1);
      }
      if (data instanceof ArrayBuffer) process.stdout.write(new Uint8Array(data));
    });

    ws.addEventListener("close", (event: CloseEvent) => {
      if (restored) return; // already handled by session:exit / error
      restoreTty();
      process.stdout.write("\n");
      if (event.code === 1000) process.exit(0);
      consola.error(`Connection closed unexpectedly (code ${event.code}).`);
      process.exit(1);
    });

    ws.addEventListener("error", () => {
      if (restored) return;
      restoreTty();
      consola.error("Could not open the shell connection.");
      process.exit(1);
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
      consola.error("exec requires an interactive terminal.");
      process.exit(1);
    }
    // Global WebSocket is available under Bun and Node ≥22.
    if (typeof WebSocket === "undefined") {
      consola.error("exec needs a WebSocket runtime — run under Bun or Node ≥22.");
      process.exit(1);
    }
    const { url, token } = await ensureAuthenticated(args.url);

    if (args.host) {
      const client = createCliClient({ url, token });
      consola.info("Connecting to a shell on the control-plane host...");
      consola.warn("The host shell is the control-plane machine itself — install-admin access only.");
      const ticket = await mintTicket(client, { kind: "host" });
      return attach(`${wsBase(url)}/pty?ticket=${encodeURIComponent(ticket)}`);
    }

    const ctx = await resolveResource(args, args.service, "service");
    const targets = await ctx.client.terminal.targets({});
    const matches = targets.containers.filter((c) => c.serviceResourceId === ctx.resourceId);
    if (matches.length === 0) {
      consola.error(`No running containers for ${ctx.resourceName}.`);
      process.exit(1);
    }
    const picked = pickContainer(matches, args.replica, ctx.resourceName);

    const slot = picked.replicaSlot ? ` (replica ${picked.replicaSlot})` : "";
    consola.info(`Connecting to ${ctx.resourceName}${slot}...`);
    const ticket = await mintTicket(ctx.client, { kind: "container", containerId: picked.containerId });
    return attach(`${wsBase(url)}/pty?ticket=${encodeURIComponent(ticket)}`);
  },
});
