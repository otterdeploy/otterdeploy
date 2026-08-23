import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { probeDomainCertificate } from "../cert-probe";

/** Listen on an ephemeral port and hand back the port number. */
function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe("probeDomainCertificate", () => {
  test("reports unreachable when nothing is listening", async () => {
    // A closed port is a connect-level failure: the edge isn't there at all,
    // which is a different operator story from "the edge served nothing".
    // Port 1 on loopback is reliably refused.
    const result = await probeDomainCertificate({
      domain: "control.example.com",
      hosts: ["127.0.0.1"],
      port: 1,
      timeoutMs: 1000,
    });

    expect(result.state).toBe("unreachable");
    expect(result.issuer).toBeNull();
    expect(result.expiresAt).toBeNull();
  });

  test("reports none when the edge answers but serves no certificate", async () => {
    // The exact shape of the incident: TCP connects, TLS produces no usable
    // certificate. Must NOT be reported as unreachable — the distinction is
    // what tells an operator "your ports are fine, issuance isn't".
    const server = createServer((socket) => socket.destroy());
    servers.push(server);
    const port = await listen(server);

    const result = await probeDomainCertificate({
      domain: "control.example.com",
      hosts: ["127.0.0.1"],
      port,
      timeoutMs: 2000,
    });

    expect(result.state).toBe("none");
  });

  test("a TLS-level failure outranks a later unreachable host", async () => {
    // The host list is tried in order and the edge answers to exactly one
    // name; an unreachable alias listed after the real edge must not
    // downgrade a real verdict to "unreachable".
    const server = createServer((socket) => socket.destroy());
    servers.push(server);
    const port = await listen(server);

    const result = await probeDomainCertificate({
      domain: "control.example.com",
      // Second host is a name that cannot resolve.
      hosts: ["127.0.0.1", "edge.invalid"],
      port,
      timeoutMs: 2000,
    });

    expect(result.state).toBe("none");
  });

  test("stamps every result with the time it was checked", async () => {
    const before = Date.now();
    const result = await probeDomainCertificate({
      domain: "control.example.com",
      hosts: ["127.0.0.1"],
      port: 1,
      timeoutMs: 1000,
    });

    expect(result.checkedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
