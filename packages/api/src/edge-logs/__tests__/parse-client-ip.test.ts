/**
 * The client-IP precedence is load-bearing for the whole Firewall surface:
 * flagged IPs, ban targets and geo all read this one field. Getting it wrong
 * behind a CDN means banning the CDN.
 */
import { describe, expect, it } from "vitest";

import { parseCaddyAccessLog } from "../parse";

function line(request: Record<string, unknown>): unknown {
  return {
    ts: 1_700_000_000,
    request: { method: "GET", host: "example.com", uri: "/", ...request },
    status: 200,
  };
}

describe("client IP attribution", () => {
  it("prefers client_ip, which is what Caddy resolves behind a trusted proxy", () => {
    const parsed = parseCaddyAccessLog(line({ client_ip: "203.0.113.7", remote_ip: "172.71.4.9" }));
    expect(parsed?.clientIp).toBe("203.0.113.7");
  });

  it("falls back to remote_ip when Caddy didn't resolve one", () => {
    expect(parseCaddyAccessLog(line({ remote_ip: "203.0.113.7" }))?.clientIp).toBe("203.0.113.7");
  });

  it("still strips the port off remote_addr as a last resort", () => {
    expect(parseCaddyAccessLog(line({ remote_addr: "203.0.113.7:54321" }))?.clientIp).toBe(
      "203.0.113.7",
    );
  });
});
