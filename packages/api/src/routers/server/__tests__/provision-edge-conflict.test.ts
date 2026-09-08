/**
 * od-u05r: a node that cannot install an edge proxy must say so.
 *
 * The failure being prevented is a specific shape of green. `installNodeProxy`
 * is best-effort by design, so on a host whose :443 was already taken the
 * `docker run` failed, one warning line was emitted, and the join still
 * reported `ready`. The operator saw a healthy node with no working edge, and
 * the only evidence scrolled past once.
 *
 * So these test two things: that we DECIDE before attempting, and that the
 * decision names something the operator can act on.
 */
import { describe, expect, it } from "vite-plus/test";

import { decideEdgeProxy } from "../provision-edge-conflict";
import { parseProbe } from "../provision-probe";

const coolify = {
  platform: "coolify" as const,
  version: "4.0.0",
  containers: ["coolify", "coolify-proxy"],
  importSupported: true,
};

describe("decideEdgeProxy", () => {
  it("installs on a clean host", () => {
    expect(decideEdgeProxy({ edgePortHolders: [], platforms: [] })).toEqual({ install: true });
  });

  it("refuses when a port is held, and names who holds it", () => {
    const decision = decideEdgeProxy({
      edgePortHolders: [{ port: 443, holder: "coolify-proxy" }],
      platforms: [],
    });
    expect(decision.install).toBe(false);
    if (!decision.install) {
      expect(decision.status).toBe("port_conflict");
      // Naming the container is the whole point: "port in use" is not
      // something anyone can act on.
      expect(decision.reason).toContain("coolify-proxy");
      expect(decision.reason).toContain("443");
    }
  });

  it("prefers the port conflict over the platform, when both apply", () => {
    // The port is what actually stops the install, it names the specific
    // container to deal with, and it stays correct for a holder we have no
    // detector for.
    const decision = decideEdgeProxy({
      edgePortHolders: [{ port: 443, holder: "coolify-proxy" }],
      platforms: [coolify],
    });
    if (!decision.install) expect(decision.status).toBe("port_conflict");
  });

  it("still refuses when a platform is present but its proxy is down", () => {
    // Taking :443 from a stopped proxy works right up until it restarts, and
    // doing that silently on someone else's workloads is not ours to do.
    const decision = decideEdgeProxy({ edgePortHolders: [], platforms: [coolify] });
    expect(decision.install).toBe(false);
    if (!decision.install) {
      expect(decision.status).toBe("platform_present");
      expect(decision.reason).toContain("coolify");
    }
  });

  it("says what to do next in every refusal", () => {
    for (const decision of [
      decideEdgeProxy({ edgePortHolders: [{ port: 80, holder: "nginx" }], platforms: [] }),
      decideEdgeProxy({ edgePortHolders: [], platforms: [coolify] }),
    ]) {
      if (!decision.install) expect(decision.reason).toContain("re-run provisioning");
    }
  });
});

describe("the probe reports what the decision needs", () => {
  it("reads a docker-published holder by container name", () => {
    const probe = parseProbe(
      ["OTTER_PRIV=root", "OTTER_PORT443=coolify-proxy", "OTTER_PORT80=coolify-proxy"].join("\n"),
    );
    expect(probe.edgePortHolders).toEqual([
      { port: 80, holder: "coolify-proxy" },
      { port: 443, holder: "coolify-proxy" },
    ]);
  });

  it("prefers the named holder over the bare ss reading of the same port", () => {
    // Both probes fire for a docker-published port. "coolify-proxy" is
    // actionable, "in use" is not.
    const probe = parseProbe(["OTTER_PORT443=in use", "OTTER_PORT443=coolify-proxy"].join("\n"));
    expect(probe.edgePortHolders).toEqual([{ port: 443, holder: "coolify-proxy" }]);
  });

  it("still reports a holder docker knows nothing about", () => {
    // A host nginx: `ss` sees it, docker does not.
    const probe = parseProbe("OTTER_PORT443=in use");
    expect(probe.edgePortHolders).toEqual([{ port: 443, holder: "unknown" }]);
  });

  it("reports no holders on a clean host", () => {
    expect(parseProbe("OTTER_PRIV=root\nOTTER_DOCKER=27.0.0").edgePortHolders).toEqual([]);
  });

  it("carries the container list for the shared platform matcher", () => {
    const probe = parseProbe(
      [
        "OTTER_PRIV=root",
        "OTTER_CONTAINERS_BEGIN",
        "abc\tcoolify\tcoollabsio/coolify:4.0.0",
        "OTTER_CONTAINERS_END",
      ].join("\n"),
    );
    expect(probe.containerList).toBe("abc\tcoolify\tcoollabsio/coolify:4.0.0");
  });

  it("degrades to no containers when the stream was truncated", () => {
    // A dropped connection mid-probe must not throw; "we could not tell" is
    // the honest answer and leaves the install to the port check.
    expect(parseProbe("OTTER_CONTAINERS_BEGIN\nabc\tx\ty").containerList).toBe("");
  });
});
