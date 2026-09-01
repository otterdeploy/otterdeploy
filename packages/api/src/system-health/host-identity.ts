import { Result } from "better-result";
/**
 * The HOST's hostname, not the container's.
 *
 * `os.hostname()` answers from the calling process's UTS namespace, and in
 * the production compose the control plane is a container, so it answered
 * with a Docker container id (`02e9009ef740`) and the Servers page showed
 * that as the machine's name. Bind-mounting `/proc` does not help: the
 * kernel resolves `/proc/sys/kernel/hostname` against the READER's
 * namespace too. What does work is the host's own `/etc/hostname`, mounted
 * read-only at a known path (docker-compose.prod.yml).
 *
 * Fallback order: the mounted host file, then the process's own hostname
 * (correct on a bare host and in local dev, a container id inside Docker).
 */
import { existsSync, readFileSync } from "node:fs";
import { hostname as osHostname } from "node:os";

const DEFAULT_HOST_HOSTNAME_PATH = "/host/etc/hostname";

function candidatePaths(): string[] {
  // oxlint-disable-next-line node/no-process-env -- deploy-time wiring, read raw like HOST_PROC_PATH
  const override = process.env.HOST_HOSTNAME_PATH;
  return override ? [override, DEFAULT_HOST_HOSTNAME_PATH] : [DEFAULT_HOST_HOSTNAME_PATH];
}

/** Read the first non-empty hostname file, or null if none is mounted. */
function readHostnameFile(paths: readonly string[]): string | null {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const read = Result.try({
      try: () => readFileSync(path, "utf8").trim(),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    if (read.isOk() && read.value.length > 0) return read.value;
  }
  return null;
}

export function hostHostname(): string {
  return readHostnameFile(candidatePaths()) ?? osHostname();
}
