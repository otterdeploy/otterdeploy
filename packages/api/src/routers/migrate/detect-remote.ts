/**
 * Detect another deploy platform on a server that is NOT the control plane.
 *
 * `detectPlatforms` reads `Docker.fromEnv()`, i.e. the control plane's own
 * daemon, and the contract had no way to ask about anything else. So a Coolify
 * install on a joined worker was invisible: not offered for migration, and not
 * mentioned anywhere in the UI, while otterdeploy happily provisioned an edge
 * proxy onto the ports Coolify's proxy already held (od-90a6).
 *
 * The detection RULES do not change and must not fork. `matchPlatforms` is
 * pure and takes `RunningContainer[]`, so the only thing missing was a second
 * way to obtain that list. This is that: `docker ps` over the same SSH session
 * provisioning already uses, parsed into the same shape.
 *
 * IMPORT IS DELIBERATELY NOT WIDENED. Reading a remote container list is a
 * one-line ssh call; importing a remote Coolify is not. The import path execs
 * `psql` inside Coolify's own postgres container and reads `APP_KEY` out of the
 * app container's env, all through the local docker client, so it would need
 * the whole transport re-pointed. Detection alone is the useful half: it turns
 * "invisible" into "named, with an explanation", which is what the operator
 * needs before anything else can be decided.
 */

import type { SshSession } from "../server/ssh-exec";

/** What `matchPlatforms` needs about each running container. */
export interface RunningContainer {
  id: string;
  name: string;
  image: string;
}

/**
 * `docker ps` in a shape that survives names and images containing spaces.
 *
 * Tab-separated rather than JSON: `--format json` varies across docker
 * versions (an object per line on modern engines, a different key casing on
 * older ones), and this has to run on a host whose docker we did not install.
 * Three fields, one tab between them, is stable everywhere back to 17.06.
 *
 * `2>/dev/null || true` so a host without docker reports "no platforms"
 * rather than failing the whole detection: not having docker is an answer.
 */
export function remoteContainerListScript(): string {
  return [
    "set +e",
    'command -v docker >/dev/null 2>&1 || { echo "OTTER_NO_DOCKER"; exit 0; }',
    "docker ps --no-trunc --format '{{.ID}}\\t{{.Names}}\\t{{.Image}}' 2>/dev/null || true",
  ].join("\n");
}

/**
 * Parse that script's output. PURE, which is the point: the parsing is the
 * only part with edge cases worth pinning, and it can be tested without a
 * host.
 *
 * Unparseable lines are SKIPPED rather than throwing. The stream can carry
 * banner text (`/etc/motd`, "Welcome to Ubuntu"), sudo warnings, or a locale
 * complaint ahead of the real output, and one of those must not cost the
 * operator the whole detection.
 */
export function parseRemoteContainers(output: string): RunningContainer[] {
  if (output.includes("OTTER_NO_DOCKER")) return [];

  const containers: RunningContainer[] = [];
  for (const line of output.split("\n")) {
    const parts = line.split("\t");
    if (parts.length !== 3) continue;
    const [id, name, image] = parts;
    // A tab-count match is not enough on its own: a banner line could contain
    // two tabs. Require all three fields to be non-empty.
    if (!id?.trim() || !name?.trim() || !image?.trim()) continue;
    containers.push({ id: id.trim(), name: name.trim(), image: image.trim() });
  }
  return containers;
}

/** The running containers on a remote host, over an existing SSH session. */
export async function listRemoteContainers(session: SshSession): Promise<RunningContainer[]> {
  const result = await session.runScript(remoteContainerListScript());
  return parseRemoteContainers(result.output);
}
