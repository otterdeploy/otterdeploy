import { spawn } from "node:child_process";

// oxlint-disable-next-line node/no-process-env -- standalone CLI env boundary
const env = process.env;

/**
 * Best-effort browser launch. Uses `node:child_process` (available under both
 * Bun and Node) so the CLI runs on either runtime. Never throws — the device
 * flow prints the URL for manual copy/paste, which is the whole point on a
 * headless server.
 */
export function openInBrowser(url: string): void {
  // Headless (a server, a container, CI) — there's no browser to open, so don't
  // even try. This is exactly where you run `otterdeploy login`.
  if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return;

  const argv =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const [cmd = "xdg-open", ...args] = argv;
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    // A missing launcher (e.g. no `xdg-open` installed) surfaces as an async
    // 'error' event, NOT a synchronous throw — without this listener Node
    // treats it as unhandled and crashes the whole CLI mid-login.
    child.on("error", () => {});
    child.unref();
  } catch {
    // Ignore — the URL is shown for manual paste.
  }
}
