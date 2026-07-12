import { spawn } from "node:child_process";

/**
 * Best-effort browser launch. Uses `node:child_process` (available under both
 * Bun and Node) so the CLI runs on either runtime. Failure is non-fatal —
 * callers also print the URL for manual copy/paste.
 */
export function openInBrowser(url: string): void {
  const argv =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const [cmd = "xdg-open", ...args] = argv;
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Ignore — the URL is shown for manual paste.
  }
}
