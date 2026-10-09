/**
 * The build sandbox's host AppArmor profile.
 *
 * Rootless BuildKit needs one user namespace; Ubuntu 23.10+ only grants one to
 * processes under an AppArmor profile that allows it. scripts/install.sh writes
 * and loads that profile on install and `update`, but an in-app upgrade only
 * swaps images, so an upgraded host had no profile and every git build was
 * refused. The builder therefore loads the same profile itself, from a
 * short-lived helper container of its own image (it already holds the docker
 * socket) that runs the host's own apparmor_parser, reading the text out of
 * install.sh so there is exactly one copy.
 */

import { Result } from "better-result";
import { readFile } from "node:fs/promises";

import type { LogSink } from "./log-stream";

import { dockerQuiet as docker } from "./run-process";

/** Host AppArmor profile that grants ONLY the sandbox permission to create a
 *  user namespace (Ubuntu's per-application pattern). Installed and loaded by
 *  scripts/install.sh, and by the builder itself on a host the installer has
 *  not prepared (loadSandboxAppArmorProfile). */
export const BUILD_SANDBOX_APPARMOR_PROFILE = "otterdeploy-buildkitd";

/** The installer, which carries the one copy of the profile text. The builder
 *  runs from source in the server image (`COPY . .`), so it sits three levels
 *  up from this file there and in a checkout alike. */
const INSTALLER_PATH = new URL("../../../scripts/install.sh", import.meta.url);

/** Name of the short-lived container that loads the profile on the host. */
export const APPARMOR_LOADER_CONTAINER = "otterdeploy-apparmor-loader";

/** Where the kernel says whether unprivileged user namespaces are restricted
 *  to AppArmor profiles that allow them (Ubuntu 23.10+ defaults it to 1). */
const USERNS_RESTRICT_SYSCTL = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

/**
 * AppArmor profile for the sandbox. PURE given the sysctl text.
 *
 * Rootless BuildKit needs a user namespace. On a host that restricts them to
 * profiles which allow it (Ubuntu 24.04: the sysctl reads 1), `unconfined` is
 * not enough: rootlesskit fails with "fork/exec /proc/self/exe: permission
 * denied". There the sandbox runs under the narrow
 * `otterdeploy-buildkitd` profile, which allows `userns` and nothing else
 * beyond unconfined. Elsewhere (sysctl absent or 0) `unconfined` works as is.
 */
export function sandboxAppArmorProfile(restrictSysctl: string | null): string {
  return restrictSysctl?.trim() === "1" ? BUILD_SANDBOX_APPARMOR_PROFILE : "unconfined";
}

export async function readUsernsRestriction(): Promise<string | null> {
  const read = await Result.tryPromise(() => readFile(USERNS_RESTRICT_SYSCTL, "utf8"));
  return read.isOk() ? read.value : null;
}

/** The installer command that prepares the host. Run on the host itself. */
export const HOST_PREP_COMMAND =
  "curl -fsSL https://get.otterdeploy.com/install.sh | sudo bash -s -- update";

/**
 * What the operator should run when the sandbox cannot start, or nothing.
 * PURE.
 *
 * On a host that restricts unprivileged user namespaces (Ubuntu 23.10+), the
 * sandbox only starts under the `otterdeploy-buildkitd` AppArmor profile. The
 * installer loads it, and the builder loads it itself before it starts the
 * sandbox (loadSandboxAppArmorProfile), so an install updated from inside the
 * app gets it too. When the sandbox is still down on such a host, the profile
 * is the usual reason: every failure there names the command, whatever docker
 * said. On other hosts the command is named only when the failure is the
 * host's user-namespace policy itself.
 */
export function hostPrepHint(apparmor: string, detail: string): string {
  const restrictedHost = apparmor === BUILD_SANDBOX_APPARMOR_PROFILE;
  const userns = /apparmor_restrict_unprivileged_userns|\/proc\/self\/exe|user namespace/i.test(
    detail,
  );
  if (!restrictedHost && !userns) return "";
  return `. This host restricts unprivileged user namespaces, so the build sandbox needs the ${BUILD_SANDBOX_APPARMOR_PROFILE} AppArmor profile. The builder loads it itself at startup and on its periodic check; if it could not, load it once by running this on the host, then retry the deploy: \`${HOST_PREP_COMMAND}\``;
}

/**
 * The profile text from scripts/install.sh: the lines of its
 * `tee ... <<'PROFILE'` heredoc, so the installer and the builder load the
 * exact same profile from one source. PURE; null when the markers are gone.
 */
export function appArmorProfileFromInstaller(installer: string): string | null {
  const lines = installer.split("\n");
  const start = lines.findIndex((line) => line.trimEnd().endsWith("<<'PROFILE'"));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line === "PROFILE");
  if (end === -1) return null;
  const body = lines.slice(start + 1, end);
  const declares = body.some((line) =>
    line.startsWith(`profile ${BUILD_SANDBOX_APPARMOR_PROFILE} `),
  );
  return declares ? `${body.join("\n")}\n` : null;
}

/**
 * What the loader runs, as the host's own shell inside `chroot /host`. PURE.
 * Skips a profile that is already loaded from identical text; otherwise
 * writes it to the host's /etc/apparmor.d (so the host's apparmor.service
 * reloads it after a reboot, exactly like the installer's copy) and loads it
 * with the HOST's `apparmor_parser -r`, the same binary install.sh runs: an
 * image's own parser can be older than the host's policy ABI (Alpine 3.22
 * ships 3.1.7, which cannot parse the `userns` rule). The
 * text arrives in OTTERDEPLOY_APPARMOR_PROFILE.
 */
export function appArmorLoaderScript(): string {
  const file = `/etc/apparmor.d/${BUILD_SANDBOX_APPARMOR_PROFILE}`;
  return [
    "set -eu",
    `f=${file}`,
    'if [ "$(cat "$f" 2>/dev/null || true)" = "$(printf %s "$OTTERDEPLOY_APPARMOR_PROFILE")" ] &&',
    `  grep -q '^${BUILD_SANDBOX_APPARMOR_PROFILE} ' /sys/kernel/security/apparmor/profiles; then`,
    '  echo "profile already loaded"; exit 0',
    "fi",
    "command -v apparmor_parser >/dev/null || { echo \"this host has no apparmor_parser (install the 'apparmor' package)\"; exit 1; }",
    'printf %s "$OTTERDEPLOY_APPARMOR_PROFILE" > "$f"',
    'apparmor_parser -r -K "$f"',
    'echo "profile loaded"',
  ].join("\n");
}

/**
 * `docker run` argv for the loader. PURE.
 *
 * Narrow on purpose: not `--privileged`; every capability dropped except
 * CAP_MAC_ADMIN (loading a policy) and CAP_SYS_CHROOT (to run the host's
 * parser); unconfined only because Docker's default AppArmor profile forbids
 * policy loads; no network. The host's root is mounted READ-ONLY (for its
 * apparmor_parser, abi and tunables); the only writable host paths are the
 * two the job changes: /etc/apparmor.d (the profile file) and the AppArmor
 * securityfs (to load it). Runs the builder's own image for its `chroot`, and
 * is removed when it exits.
 */
export function appArmorLoaderRunArgs(image: string, profile: string): string[] {
  return [
    "run",
    "--rm",
    "--name",
    APPARMOR_LOADER_CONTAINER,
    "--label",
    "otterdeploy.role=apparmor-loader",
    "--network",
    "none",
    "--user",
    "0:0",
    "--cap-drop",
    "ALL",
    "--cap-add",
    "MAC_ADMIN",
    "--cap-add",
    "SYS_CHROOT",
    "--security-opt",
    "apparmor=unconfined",
    "--security-opt",
    "no-new-privileges",
    "-v",
    "/:/host:ro",
    "-v",
    "/etc/apparmor.d:/host/etc/apparmor.d",
    "-v",
    "/sys/kernel/security:/host/sys/kernel/security",
    "-e",
    `OTTERDEPLOY_APPARMOR_PROFILE=${profile}`,
    "--entrypoint",
    "chroot",
    image,
    "/host",
    "/bin/sh",
    "-c",
    appArmorLoaderScript(),
  ];
}

/**
 * Load the sandbox's AppArmor profile on the host through a short-lived
 * helper container. install.sh does this on install and
 * `update`, but an in-app upgrade only swaps images, so on Ubuntu 23.10+ the
 * profile was missing and every git build was refused until the operator ran
 * the installer by hand. The builder already holds the docker socket, so it
 * can do the same host step itself. Ok(detail) or Err(why it could not).
 */
async function loadSandboxAppArmorProfile(
  sink: LogSink,
  image: string,
  installerPath: URL | string = INSTALLER_PATH,
): Promise<Result<string, string>> {
  const installer = await Result.tryPromise(() => readFile(installerPath, "utf8"));
  if (installer.isErr()) return Result.err("the profile source (scripts/install.sh) is missing");
  const profile = appArmorProfileFromInstaller(installer.value);
  if (profile === null) return Result.err("scripts/install.sh carries no sandbox profile");
  sink.system(
    `loading the ${BUILD_SANDBOX_APPARMOR_PROFILE} AppArmor profile on this host (it restricts unprivileged user namespaces)`,
  );
  // A loader left behind by a killed builder would block the name.
  await docker(sink, ["rm", "--force", APPARMOR_LOADER_CONTAINER]);
  const ran = await docker(sink, appArmorLoaderRunArgs(image, profile));
  if (ran.isErr()) return Result.err(ran.error);
  const tail = ran.value.tail.trim().split("\n").slice(-2).join(" | ");
  return ran.value.exitCode === 0
    ? Result.ok(tail)
    : Result.err(tail || `exit ${ran.value.exitCode}`);
}

/** Load the profile before the sandbox (re)starts under it. Returns "" when it
 *  loaded, else a clause for the refusal reason: a failed load is not fatal by
 *  itself (install.sh may have loaded it already), so the sandbox still gets
 *  its start, and if that fails the refusal says why the load failed too. */
export async function ensureSandboxAppArmorProfile(
  sink: LogSink,
  image: string,
  installerPath?: URL | string,
): Promise<string> {
  const loaded = await loadSandboxAppArmorProfile(sink, image, installerPath);
  if (loaded.isErr()) {
    return `; loading the ${BUILD_SANDBOX_APPARMOR_PROFILE} AppArmor profile failed: ${loaded.error}`;
  }
  sink.system(`${BUILD_SANDBOX_APPARMOR_PROFILE}: ${loaded.value}`);
  return "";
}
