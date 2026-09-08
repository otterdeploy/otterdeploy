/**
 * od-90a6: detecting another platform on a server that is not the control
 * plane.
 *
 * The parsing is the only part with edge cases, and every one of them comes
 * from the same fact: this reads a shell stream from a host whose docker we did
 * not install and whose login may print anything it likes first.
 */
import { describe, expect, it } from "vite-plus/test";

import { matchPlatforms } from "../coolify";
import { parseRemoteContainers, remoteContainerListScript } from "../detect-remote";

const line = (id: string, name: string, image: string) => `${id}\t${name}\t${image}`;

describe("parseRemoteContainers", () => {
  it("parses the tab-separated docker ps output", () => {
    const out = [
      line("abc123", "coolify", "ghcr.io/coollabsio/coolify:4.0.0-beta.420"),
      line("def456", "coolify-db", "postgres:15-alpine"),
    ].join("\n");

    expect(parseRemoteContainers(out)).toEqual([
      { id: "abc123", name: "coolify", image: "ghcr.io/coollabsio/coolify:4.0.0-beta.420" },
      { id: "def456", name: "coolify-db", image: "postgres:15-alpine" },
    ]);
  });

  it("reports no containers when the host has no docker", () => {
    // Not having docker is an ANSWER, not a failure: the scan ran fine.
    expect(parseRemoteContainers("OTTER_NO_DOCKER\n")).toEqual([]);
  });

  it("skips login banners and warnings ahead of the real output", () => {
    // The thing that actually breaks naive parsers. An MOTD or a sudo warning
    // must not cost the operator the whole detection.
    const out = [
      "Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)",
      "",
      "  System information as of Mon Sep  8 09:00:00 UTC 2026",
      "sudo: unable to resolve host prod-04: Name or service not known",
      line("abc123", "coolify", "coollabsio/coolify:4.0.0"),
    ].join("\n");

    expect(parseRemoteContainers(out)).toEqual([
      { id: "abc123", name: "coolify", image: "coollabsio/coolify:4.0.0" },
    ]);
  });

  it("skips a line whose fields are not all present", () => {
    expect(parseRemoteContainers(["abc\t\timage", "\tname\timage"].join("\n"))).toEqual([]);
  });

  it("handles empty output", () => {
    expect(parseRemoteContainers("")).toEqual([]);
  });
});

describe("remoteContainerListScript", () => {
  it("degrades instead of failing when docker is absent", () => {
    const script = remoteContainerListScript();
    expect(script).toContain("OTTER_NO_DOCKER");
    // No `set -e`: a docker that errors must still let the script exit 0 so
    // the caller reads "no platforms" rather than a hard failure.
    expect(script).toContain("set +e");
  });

  it("asks for the three fields the parser expects, untruncated", () => {
    // `--no-trunc` matters: a truncated image ref loses the tag, and the tag is
    // what `matchPlatforms` reads the platform VERSION out of.
    const script = remoteContainerListScript();
    expect(script).toContain("--no-trunc");
    expect(script).toContain("{{.ID}}\\t{{.Names}}\\t{{.Image}}");
  });
});

describe("the remote path and the local path share one rule", () => {
  it("recognises Coolify from remotely-parsed containers", () => {
    // The whole point of feeding `matchPlatforms`: a platform recognised on the
    // control plane and not on a worker would be worse than detecting neither.
    const containers = parseRemoteContainers(
      [
        line("a", "coolify", "ghcr.io/coollabsio/coolify:4.0.0-beta.420"),
        line("b", "coolify-db", "postgres:15-alpine"),
        line("c", "coolify-redis", "redis:7-alpine"),
      ].join("\n"),
    );

    const found = matchPlatforms(containers);
    expect(found).toHaveLength(1);
    expect(found[0]?.platform).toBe("coolify");
    expect(found[0]?.containers).toEqual(["coolify", "coolify-db", "coolify-redis"]);
  });

  it("finds nothing on a host running only otterdeploy's own containers", () => {
    const containers = parseRemoteContainers(
      [
        line("a", "otterdeploy-caddy-node", "ghcr.io/otterdeploy/caddy:0.22.0"),
        line("b", "od-praxly-api", "ghcr.io/praxly-md/server:latest"),
      ].join("\n"),
    );
    expect(matchPlatforms(containers)).toEqual([]);
  });
});
