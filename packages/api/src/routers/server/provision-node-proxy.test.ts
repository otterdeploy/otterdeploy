import { describe, expect, test } from "vite-plus/test";

import {
  NODE_PROXY_CONTAINER,
  nodeProxyInstallScript,
  PROXY_UNSUPPORTED_EXIT,
} from "./provision-node-proxy";

const IMAGE = "ghcr.io/otterdeploy/caddy:v0.8.8";
const script = (over = {}) =>
  nodeProxyInstallScript({ privilege: "root", image: IMAGE, ...over }, "");

describe("nodeProxyInstallScript", () => {
  test("publishes the edge ports so the node can serve traffic itself", () => {
    // The whole point: a node that can only be reached via the control plane
    // goes dark with it.
    const s = script();
    expect(s).toContain("-p 80:80");
    expect(s).toContain("-p 443:443");
    expect(s).toContain("-p 443:443/udp");
  });

  test("is idempotent. A re-provision converges instead of stacking listeners", () => {
    const s = script();
    expect(s).toContain(`docker rm -f ${NODE_PROXY_CONTAINER}`);
    expect(s.indexOf("docker rm -f")).toBeLessThan(s.indexOf("docker run -d"));
  });

  test("skips cleanly when docker isn't usable, rather than failing the provision", () => {
    const s = script();
    expect(s).toContain("command -v docker");
    expect(s).toContain(`exit ${PROXY_UNSUPPORTED_EXIT}`);
  });

  test("bootstrap config answers 503 instead of refusing the connection", () => {
    // An edge that is up with no routes should say so. A refused connection is
    // indistinguishable from a dead host.
    const s = script();
    expect(s).toContain("503");
    expect(s).toContain("/etc/otterdeploy/edge/Caddyfile");
  });

  test("does not clobber a Caddyfile the control plane already reconciled", () => {
    expect(script()).toContain("if [ ! -s /etc/otterdeploy/edge/Caddyfile ]");
  });

  test("survives a restart of the node", () => {
    expect(script()).toContain("--restart unless-stopped");
  });

  test("carries the managed labels the platform filters on", () => {
    const s = script();
    expect(s).toContain("otterdeploy.managed=true");
    expect(s).toContain("otterdeploy.role=edge");
  });

  test("joins the networks it needs to reach service containers", () => {
    const s = script({ networks: ["otterdeploy-store", "otterdeploy-shop"] });
    expect(s).toContain("--network otterdeploy-store");
    expect(s).toContain("--network otterdeploy-shop");
  });

  test("prefixes every privileged command when running via sudo", () => {
    const s = nodeProxyInstallScript({ privilege: "sudo", image: IMAGE }, "sudo");
    expect(s).toContain("sudo docker run -d");
    expect(s).toContain("sudo docker rm -f");
    expect(s).toContain("sudo mkdir -p /etc/otterdeploy/edge");
  });

  test("its container name can't be confused with the control plane's own", () => {
    // The control plane's compose container is `otterdeploy-caddy-1`; name
    // matching between them would be a genuinely bad day.
    expect(NODE_PROXY_CONTAINER).not.toBe("otterdeploy-caddy-1");
    expect(NODE_PROXY_CONTAINER).toContain("-node");
  });
});
