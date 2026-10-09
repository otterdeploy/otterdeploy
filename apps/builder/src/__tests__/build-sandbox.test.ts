/**
 * The rootless build sandbox's `docker run` argv and provisioning decisions
 * (od-48w). Pure-function tests: the flag set that makes a tenant build step
 * unprivileged is asserted here, so a future edit cannot quietly drop it. The
 * same argv was booted on a real Ubuntu 24.04 host.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BUILD_SANDBOX_CONTAINER,
  BUILD_SANDBOX_ENDPOINT,
  BUILD_SANDBOX_IMAGE,
  BUILD_SANDBOX_NETWORK,
  buildSandboxLimits,
  buildSandboxRunArgs,
  buildSandboxSpecHash,
  parseSandboxState,
  planSandbox,
} from "../build-sandbox";
import {
  APPARMOR_LOADER_CONTAINER,
  appArmorLoaderRunArgs,
  appArmorLoaderScript,
  appArmorProfileFromInstaller,
  BUILD_SANDBOX_APPARMOR_PROFILE,
  HOST_PREP_COMMAND,
  hostPrepHint,
  sandboxAppArmorProfile,
} from "../build-sandbox-apparmor";

const GiB = 1024 ** 3;
const limits = buildSandboxLimits(8 * GiB, 4);
const args = buildSandboxRunArgs(BUILD_SANDBOX_IMAGE, limits, "unconfined");
const flagValue = (flag: string) => args[args.indexOf(flag) + 1];

describe("buildSandboxRunArgs (od-48w isolation invariants)", () => {
  test("is never privileged and adds no capabilities", () => {
    expect(args).not.toContain("--privileged");
    expect(args.join(" ")).not.toMatch(/--cap-add/);
    expect(args.join(" ")).not.toMatch(/--device/);
  });

  test("mounts nothing from the host: no docker socket, no data folder", () => {
    const mounts = args.flatMap((a, i) => (args[i - 1] === "-v" ? [a] : []));
    expect(mounts).toEqual(["otterdeploy-buildkitd-state:/home/user/.local/share/buildkit"]);
    expect(args.join(" ")).not.toMatch(/docker\.sock/);
  });

  test("runs the pinned rootless image", () => {
    expect(BUILD_SANDBOX_IMAGE).toMatch(/^moby\/buildkit:v[\d.]+-rootless@sha256:[0-9a-f]{64}$/);
    expect(args).toContain(BUILD_SANDBOX_IMAGE);
  });

  test("never grants an insecure entitlement and never opens a listener", () => {
    expect(args.join(" ")).not.toMatch(/allow-insecure-entitlement|security\.insecure/);
    expect(args.join(" ")).not.toMatch(/--addr|tcp:\/\//);
  });

  test("lives on its own network, never the shared compose network", () => {
    expect(flagValue("--network")).toBe(BUILD_SANDBOX_NETWORK);
    expect(BUILD_SANDBOX_NETWORK).not.toBe("otterdeploy");
  });

  test("bounds memory (no swap headroom), cpus and pids", () => {
    expect(flagValue("--memory")).toBe(String(6 * GiB));
    expect(flagValue("--memory-swap")).toBe(String(6 * GiB));
    expect(flagValue("--cpus")).toBe("4");
    expect(flagValue("--pids-limit")).toBe("4096");
  });

  test("passes buildkitd the rootless-in-a-container flags and a bounded GC", () => {
    const daemonArgs = args.slice(args.indexOf(BUILD_SANDBOX_IMAGE) + 1);
    expect(daemonArgs).toContain("--oci-worker-no-process-sandbox");
    expect(daemonArgs).toContain("--oci-worker-gc");
    expect(daemonArgs.some((a) => a.startsWith("--oci-worker-gc-keepstorage="))).toBe(true);
  });

  test("labels the container with the spec hash", () => {
    const hash = buildSandboxSpecHash(BUILD_SANDBOX_IMAGE, limits, "unconfined");
    expect(args).toContain(`otterdeploy.buildkitd.spec=${hash}`);
    expect(flagValue("--name")).toBe(BUILD_SANDBOX_CONTAINER);
  });

  test("buildx dials it through docker exec, not a socket or port", () => {
    expect(BUILD_SANDBOX_ENDPOINT).toBe(`docker-container://${BUILD_SANDBOX_CONTAINER}`);
  });
});

describe("sandboxAppArmorProfile", () => {
  test("uses the narrow userns profile where unprivileged userns are restricted (Ubuntu 24.04)", () => {
    expect(sandboxAppArmorProfile("1\n")).toBe(BUILD_SANDBOX_APPARMOR_PROFILE);
    const restricted = buildSandboxRunArgs(
      BUILD_SANDBOX_IMAGE,
      limits,
      sandboxAppArmorProfile("1"),
    );
    expect(restricted).toContain("apparmor=otterdeploy-buildkitd");
  });

  test("uses unconfined where they are not (sysctl 0 or absent)", () => {
    expect(sandboxAppArmorProfile("0")).toBe("unconfined");
    expect(sandboxAppArmorProfile(null)).toBe("unconfined");
  });

  test("a different profile is a different spec (so the sandbox is recreated)", () => {
    expect(buildSandboxSpecHash(BUILD_SANDBOX_IMAGE, limits, "unconfined")).not.toBe(
      buildSandboxSpecHash(BUILD_SANDBOX_IMAGE, limits, BUILD_SANDBOX_APPARMOR_PROFILE),
    );
  });
});

describe("buildSandboxLimits", () => {
  test("takes 75% of host memory and every cpu", () => {
    expect(buildSandboxLimits(4 * GiB, 2)).toEqual({
      memoryBytes: 3 * GiB,
      cpus: "2",
      pidsLimit: "4096",
    });
  });

  test("keeps a usable floor on a tiny host and a cpu when the count is unknown", () => {
    expect(buildSandboxLimits(256 * 1024 ** 2, null)).toEqual({
      memoryBytes: 512 * 1024 ** 2,
      cpus: "1",
      pidsLimit: "4096",
    });
  });
});

describe("parseSandboxState", () => {
  test("reads running + spec label", () => {
    expect(parseSandboxState("true abc123\n")).toEqual({ running: true, spec: "abc123" });
    expect(parseSandboxState("false abc123")).toEqual({ running: false, spec: "abc123" });
  });

  test("a container without the label has an empty spec", () => {
    expect(parseSandboxState("true <no value>")).toEqual({ running: true, spec: "" });
  });

  test("anything else is unknown", () => {
    expect(parseSandboxState("")).toBeNull();
    expect(parseSandboxState("Error: No such object")).toBeNull();
  });
});

describe("planSandbox", () => {
  test("creates a missing sandbox", () => {
    expect(planSandbox(null, "h", false)).toBe("create");
  });

  test("starts a stopped one", () => {
    expect(planSandbox({ running: false, spec: "h" }, "h", false)).toBe("start");
  });

  test("leaves a running, current one alone", () => {
    expect(planSandbox({ running: true, spec: "h" }, "h", true)).toBe("ready");
  });

  test("recreates a drifted one only when allowed (never from inside a build)", () => {
    expect(planSandbox({ running: true, spec: "old" }, "h", true)).toBe("recreate");
    expect(planSandbox({ running: true, spec: "old" }, "h", false)).toBe("ready");
  });
});

describe("hostPrepHint", () => {
  test("names the installer command when the host blocks the user namespace", () => {
    const hint = hostPrepHint(
      BUILD_SANDBOX_APPARMOR_PROFILE,
      "[rootlesskit:parent] error: failed to start the child: fork/exec /proc/self/exe: permission denied",
    );
    expect(hint).toContain("install.sh | sudo bash -s -- update");
    expect(hint).toContain(BUILD_SANDBOX_APPARMOR_PROFILE);
  });

  test("names it when docker cannot find the profile", () => {
    const hint = hostPrepHint(
      BUILD_SANDBOX_APPARMOR_PROFILE,
      "docker: Error response from daemon: AppArmor enabled on system but the otterdeploy-buildkitd profile could not be loaded",
    );
    expect(hint).toContain("install.sh");
  });

  test("on a host that restricts user namespaces, names the exact command for any failure", () => {
    // The profile is the likely gap even when docker's message does not say so.
    const hint = hostPrepHint(BUILD_SANDBOX_APPARMOR_PROFILE, "context deadline exceeded");
    expect(hint).toContain(HOST_PREP_COMMAND);
    expect(hint).toContain("The builder loads it itself");
  });

  test("names it on an unrestricted host when the failure is the user-namespace policy", () => {
    expect(hostPrepHint("unconfined", "fork/exec /proc/self/exe: permission denied")).toContain(
      HOST_PREP_COMMAND,
    );
  });

  test("stays quiet for unrelated failures on an unrestricted host", () => {
    expect(hostPrepHint("unconfined", "pull access denied for moby/buildkit")).toBe("");
  });
});

describe("the AppArmor profile the builder loads itself", () => {
  const installer = readFileSync(
    join(import.meta.dir, "..", "..", "..", "..", "scripts", "install.sh"),
    "utf8",
  );

  test("is read out of install.sh's own heredoc: one profile text, two loaders", () => {
    const profile = appArmorProfileFromInstaller(installer);
    expect(profile).not.toBeNull();
    expect(profile).toContain(`profile ${BUILD_SANDBOX_APPARMOR_PROFILE} flags=(unconfined) {`);
    expect(profile).toContain("  userns,");
    // Byte for byte what install.sh tees into /etc/apparmor.d.
    const heredoc = installer.split("<<'PROFILE'\n")[1]?.split("\nPROFILE\n")[0];
    expect(profile).toBe(`${heredoc}\n`);
  });

  test("refuses an installer without the markers or without the profile", () => {
    expect(appArmorProfileFromInstaller("#!/bin/sh\necho hi\n")).toBeNull();
    expect(
      appArmorProfileFromInstaller("tee x <<'PROFILE'\nprofile other {}\nPROFILE\n"),
    ).toBeNull();
  });

  const loader = appArmorLoaderRunArgs("ghcr.io/otterdeploy/server:v1", "profile text\n");
  const after = (flag: string) => loader.flatMap((arg, i) => (arg === flag ? [loader[i + 1]] : []));

  test("is a short-lived container with two capabilities and no network", () => {
    expect(loader.slice(0, 4)).toEqual(["run", "--rm", "--name", APPARMOR_LOADER_CONTAINER]);
    expect(loader).not.toContain("--privileged");
    expect(after("--cap-drop")).toEqual(["ALL"]);
    expect(after("--cap-add")).toEqual(["MAC_ADMIN", "SYS_CHROOT"]);
    expect(after("--network")).toEqual(["none"]);
  });

  test("sees the host read-only and writes only the profile directory and securityfs", () => {
    expect(after("-v")).toEqual([
      "/:/host:ro",
      "/etc/apparmor.d:/host/etc/apparmor.d",
      "/sys/kernel/security:/host/sys/kernel/security",
    ]);
  });

  test("runs the HOST's apparmor_parser (an image's can be too old for `userns`)", () => {
    expect(after("-e")).toEqual(["OTTERDEPLOY_APPARMOR_PROFILE=profile text\n"]);
    expect(after("--entrypoint")).toEqual(["chroot"]);
    const image = loader.indexOf("ghcr.io/otterdeploy/server:v1");
    expect(loader.slice(image + 1, image + 4)).toEqual(["/host", "/bin/sh", "-c"]);
    expect(loader.at(-1)).toBe(appArmorLoaderScript());
    expect(appArmorLoaderScript()).toContain(`apparmor_parser -r -K "$f"`);
    expect(appArmorLoaderScript()).toContain(`f=/etc/apparmor.d/${BUILD_SANDBOX_APPARMOR_PROFILE}`);
  });
});
