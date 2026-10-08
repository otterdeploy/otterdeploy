/**
 * od-48w: the builder provisions its own rootless build sandbox, so an in-app
 * upgrade (which never refreshes the compose file) still gets one, and a build
 * is REFUSED rather than run unisolated when it cannot start.
 *
 * The real `ensureBuildSandbox` / `ensureBuildxBuilder` run here against a fake
 * `docker` placed first on PATH. The fake keeps its state in files (does the
 * network / sandbox / builder exist, is the sandbox running, does it answer)
 * and records every argv, so each test sees exactly which docker calls the
 * builder made, with no module mocking.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LogSink } from "../log-stream";

import {
  BUILD_SANDBOX_CONTAINER,
  BUILD_SANDBOX_ENDPOINT,
  buildHelpersRunning,
  ensureBuildSandbox,
} from "../build-sandbox";
import { ensureBuildxBuilder } from "../buildx";

// eslint-disable-next-line node/no-process-env
const originalPath = process.env.PATH;
const tmpDirs: string[] = [];

afterEach(() => {
  // eslint-disable-next-line node/no-process-env
  process.env.PATH = originalPath;
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface FakeHost {
  /** Mark a piece of fake docker state present. */
  set: (flag: string, value?: string) => void;
  has: (flag: string) => boolean;
  /** Every docker argv, one joined line per call. */
  calls: () => string[];
}

/**
 * A fake `docker` with just enough state for the sandbox + buildx flows.
 * Flags (files in the state dir): network, sandbox, running, ready, legacy,
 * legacy-builder, builder (contents = endpoint), run-fails, create-fails,
 * helpers (a running build helper).
 */
function installFakeDocker(): FakeHost {
  const binDir = mkdtempSync(join(tmpdir(), "otter-fake-docker-bin-"));
  const state = mkdtempSync(join(tmpdir(), "otter-fake-docker-state-"));
  tmpDirs.push(binDir, state);
  const log = join(state, "calls.log");
  const f = (flag: string) => join(state, flag);
  const script = [
    "#!/bin/sh",
    `S="${state}"`,
    `printf '%s\\n' "$*" >> "${log}"`,
    'case "$1 $2" in',
    '  "network inspect") [ -e "$S/network" ] && exit 0; exit 1 ;;',
    '  "network create") : > "$S/network"; exit 0 ;;',
    '  "ps -q") [ -e "$S/helpers" ] && echo abc123; exit 0 ;;',
    '  "buildx inspect")',
    '    if [ "$3" = "otterdeploy-cache" ]; then [ -e "$S/legacy-builder" ] && exit 0; exit 1; fi',
    '    [ -e "$S/builder" ] || exit 1',
    '    echo "Name: $3"; echo "Driver: remote"; echo "Endpoint:         $(cat "$S/builder")"; exit 0 ;;',
    '  "buildx rm") [ "$4" = "otterdeploy-cache" ] && rm -f "$S/legacy-builder" || rm -f "$S/builder"; exit 0 ;;',
    '  "buildx create")',
    '    [ -e "$S/create-fails" ] && { echo "ERROR: create refused" >&2; exit 1; }',
    '    for a in "$@"; do last="$a"; done; printf %s "$last" > "$S/builder"; exit 0 ;;',
    "esac",
    'case "$1" in',
    "  inspect)",
    '    for a in "$@"; do last="$a"; done',
    '    if [ "$last" = "buildx_buildkit_otterdeploy-cache0" ]; then [ -e "$S/legacy" ] && exit 0; exit 1; fi',
    '    [ -e "$S/sandbox" ] || { echo "Error: No such object" >&2; exit 1; }',
    '    if [ -e "$S/running" ]; then r=true; else r=false; fi',
    '    echo "$r $(cat "$S/sandbox")"; exit 0 ;;',
    "  run)",
    '    if [ -e "$S/run-fails" ]; then',
    '      [ -e "$S/run-leaves-created" ] && printf %s created > "$S/sandbox"',
    '      echo "docker: Error response from daemon: AppArmor enabled on system but the otterdeploy-buildkitd profile could not be loaded." >&2; exit 125',
    "    fi",
    '    for a in "$@"; do case "$a" in otterdeploy.buildkitd.spec=*) spec="${a#*=}" ;; esac; done',
    '    printf %s "$spec" > "$S/sandbox"; : > "$S/running"; exit 0 ;;',
    '  start) : > "$S/running"; exit 0 ;;',
    '  rm) if [ "$3" = "buildx_buildkit_otterdeploy-cache0" ]; then rm -f "$S/legacy"; else rm -f "$S/sandbox" "$S/running"; fi; exit 0 ;;',
    '  exec) [ -e "$S/running" ] && [ -e "$S/ready" ] && exit 0; exit 1 ;;',
    '  logs) echo "[rootlesskit:parent] error: failed to start the child: fork/exec /proc/self/exe: permission denied"; exit 0 ;;',
    "esac",
    "exit 0",
    "",
  ].join("\n");
  const docker = join(binDir, "docker");
  writeFileSync(docker, script);
  chmodSync(docker, 0o755);
  // eslint-disable-next-line node/no-process-env
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  return {
    set: (flag, value = "") => writeFileSync(f(flag), value),
    has: (flag) => existsSync(f(flag)),
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []),
  };
}

function sink(): { sink: LogSink; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    sink: {
      write: (_stream, line) => void lines.push(line),
      system: (line) => void lines.push(line),
      setPhase: () => undefined,
      close: () => Promise.resolve(),
    },
  };
}

describe("ensureBuildSandbox against a fake docker", () => {
  test("provisions network + sandbox on a fresh host and returns the exec endpoint", async () => {
    const host = installFakeDocker();
    host.set("ready");
    const out = sink();
    const ready = await ensureBuildSandbox(out.sink, { recreateOnDrift: true });
    expect(ready.isOk() && ready.value).toBe(BUILD_SANDBOX_ENDPOINT);
    expect(host.has("network")).toBe(true);
    const run = host.calls().find((c) => c.startsWith("run -d"));
    expect(run).toContain(`--name ${BUILD_SANDBOX_CONTAINER}`);
    expect(run).not.toContain("--privileged");
    expect(run).toContain("--oci-worker-no-process-sandbox");
  });

  test("is idempotent: a running, current sandbox is left alone", async () => {
    const host = installFakeDocker();
    host.set("ready");
    await ensureBuildSandbox(sink().sink, { recreateOnDrift: true });
    const before = host.calls().filter((c) => c.startsWith("run ")).length;
    const again = await ensureBuildSandbox(sink().sink, { recreateOnDrift: true });
    expect(again.isOk()).toBe(true);
    expect(host.calls().filter((c) => c.startsWith("run ")).length).toBe(before);
    expect(host.calls().some((c) => c.startsWith("rm "))).toBe(false);
  });

  test("restarts a stopped sandbox instead of recreating it", async () => {
    const host = installFakeDocker();
    host.set("ready");
    host.set("network");
    host.set("sandbox", "any-spec"); // exists, not running
    const ready = await ensureBuildSandbox(sink().sink, { recreateOnDrift: false });
    expect(ready.isOk()).toBe(true);
    expect(host.calls()).toContain(`start ${BUILD_SANDBOX_CONTAINER}`);
    expect(host.calls().some((c) => c.startsWith("run "))).toBe(false);
  });

  test("recreates a sandbox from an older spec when no build is running", async () => {
    const host = installFakeDocker();
    host.set("ready");
    host.set("network");
    host.set("sandbox", "old-spec");
    host.set("running");
    const ready = await ensureBuildSandbox(sink().sink, { recreateOnDrift: true });
    expect(ready.isOk()).toBe(true);
    expect(host.calls()).toContain(`rm --force ${BUILD_SANDBOX_CONTAINER}`);
    expect(host.calls().some((c) => c.startsWith("run -d"))).toBe(true);
  });

  test("never recreates from inside a build (it would kill the other builds)", async () => {
    const host = installFakeDocker();
    host.set("ready");
    host.set("network");
    host.set("sandbox", "old-spec");
    host.set("running");
    const ready = await ensureBuildSandbox(sink().sink, { recreateOnDrift: false });
    expect(ready.isOk()).toBe(true);
    expect(host.calls().some((c) => c.startsWith("rm ") || c.startsWith("run "))).toBe(false);
  });

  test("fails closed with the installer command when the host blocks the user namespace", async () => {
    installFakeDocker(); // never "ready": rootlesskit cannot start
    const out = sink();
    const ready = await ensureBuildSandbox(out.sink, {
      recreateOnDrift: true,
      readyTimeoutMs: 1_500,
      usernsRestriction: "1",
    });
    expect(ready.isErr()).toBe(true);
    if (ready.isErr()) {
      expect(ready.error._tag).toBe("BuildIsolationError");
      expect(ready.error.reason).toContain("did not become ready");
      expect(ready.error.reason).toContain("install.sh | sudo bash -s -- update");
      expect(ready.error.message).toContain("refused rather than run unisolated");
    }
  });

  test("fails closed when docker refuses to create it (missing AppArmor profile)", async () => {
    const host = installFakeDocker();
    host.set("run-fails");
    const ready = await ensureBuildSandbox(sink().sink, { recreateOnDrift: true });
    expect(ready.isErr() && ready.error.reason).toContain("could not start otterdeploy-buildkitd");
  });
});

describe("a refused start that leaves a stopped container", () => {
  test("reports docker's error and the host-prep command, not a readiness timeout, and cleans up", async () => {
    const host = installFakeDocker();
    host.set("run-fails");
    host.set("run-leaves-created");
    const ready = await ensureBuildSandbox(sink().sink, {
      recreateOnDrift: true,
      readyTimeoutMs: 30_000,
      usernsRestriction: "1", // Ubuntu 24.04
    });
    expect(ready.isErr()).toBe(true);
    if (ready.isErr()) {
      expect(ready.error.reason).toContain("profile could not be loaded");
      expect(ready.error.reason).toContain("install.sh | sudo bash -s -- update");
      expect(ready.error.reason).not.toContain("did not become ready");
    }
    expect(host.has("sandbox")).toBe(false);
  });
});

describe("buildHelpersRunning", () => {
  test("reports a running helper, and none when there is none", async () => {
    const host = installFakeDocker();
    expect(await buildHelpersRunning(sink().sink)).toBe(false);
    host.set("helpers");
    expect(await buildHelpersRunning(sink().sink)).toBe(true);
  });
});

describe("ensureBuildxBuilder against a fake docker", () => {
  const isolated = { buildkitHost: "", allowUnisolated: false };

  test("registers the remote builder on the sandbox endpoint and removes the legacy privileged one", async () => {
    const host = installFakeDocker();
    host.set("ready");
    host.set("legacy");
    host.set("legacy-builder");
    const built = await ensureBuildxBuilder(sink().sink, isolated);
    expect(built.isOk() && built.value).toBe("otterdeploy-rootless");
    expect(host.has("legacy")).toBe(false);
    expect(host.has("legacy-builder")).toBe(false);
    const create = host.calls().find((c) => c.startsWith("buildx create"));
    expect(create).toBe(
      `buildx create --name otterdeploy-rootless --driver remote --bootstrap ${BUILD_SANDBOX_ENDPOINT}`,
    );
  });

  test("re-registers a builder that points somewhere else", async () => {
    const host = installFakeDocker();
    host.set("ready");
    host.set("builder", "unix:///data/otterdeploy/build/buildkit/buildkitd.sock");
    const built = await ensureBuildxBuilder(sink().sink, isolated);
    expect(built.isOk()).toBe(true);
    expect(host.calls()).toContain("buildx rm --force otterdeploy-rootless");
  });

  test("refuses the build when the sandbox cannot start (no silent host-daemon fallback)", async () => {
    const host = installFakeDocker();
    host.set("run-fails");
    const built = await ensureBuildxBuilder(sink().sink, isolated);
    expect(built.isErr()).toBe(true);
    expect(host.calls().some((c) => c.startsWith("buildx create"))).toBe(false);
  });

  test("refuses the build when the builder cannot be registered", async () => {
    const host = installFakeDocker();
    host.set("ready");
    host.set("create-fails");
    const built = await ensureBuildxBuilder(sink().sink, isolated);
    expect(built.isErr() && built.error.reason).toContain("could not register");
  });

  test("the explicit opt-out builds on the host daemon and provisions nothing", async () => {
    const host = installFakeDocker();
    const out = sink();
    const built = await ensureBuildxBuilder(out.sink, { buildkitHost: "", allowUnisolated: true });
    expect(built.isOk() && built.value).toBeNull();
    expect(host.calls().some((c) => c.startsWith("run ") || c.startsWith("network"))).toBe(false);
    expect(out.lines.join("\n")).toContain("without tenant isolation");
  });
});
