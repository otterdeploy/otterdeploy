import { describe, expect, test } from "vitest";

import {
  firewallBouncerInstallScript,
  managerHostOf,
  UNSUPPORTED_DISTRO_EXIT,
} from "../provision-firewall";

describe("managerHostOf", () => {
  test("strips the swarm port", () => {
    expect(managerHostOf("10.0.0.5:2377")).toBe("10.0.0.5");
    expect(managerHostOf("100.64.1.9")).toBe("100.64.1.9");
  });

  test("keeps bracketed IPv6 intact", () => {
    expect(managerHostOf("[fd00::1]:2377")).toBe("[fd00::1]");
  });
});

describe("firewallBouncerInstallScript", () => {
  const script = firewallBouncerInstallScript("http://10.0.0.5:8080/", "k".repeat(32), "sudo");

  test("installs the nftables bouncer from packagecloud (noble pinned on ubuntu)", () => {
    expect(script).toContain("crowdsec-firewall-bouncer-nftables");
    expect(script).toContain('PC_ENV="os=ubuntu dist=noble"');
    expect(script).toContain("packagecloud.io/install/repositories/crowdsec/crowdsec");
  });

  test("writes the LAPI url + key into the bouncer config and locks it down", () => {
    expect(script).toContain("api_url: http://10.0.0.5:8080/");
    expect(script).toContain(`api_key: ${"k".repeat(32)}`);
    expect(script).toContain("chmod 600 /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml");
  });

  test("starts + verifies the service and probes LAPI reachability", () => {
    expect(script).toContain("systemctl enable --now crowdsec-firewall-bouncer");
    expect(script).toContain("systemctl is-active crowdsec-firewall-bouncer");
    expect(script).toContain("http://10.0.0.5:8080/health");
    expect(script).toContain("CROWDSEC_LAPI_BIND");
  });

  test("bails with the sentinel exit on non-apt distros", () => {
    expect(script).toContain(`exit ${UNSUPPORTED_DISTRO_EXIT}`);
  });

  test("respects the no-sudo (root) form", () => {
    const root = firewallBouncerInstallScript("http://m:8080/", "key0123456789abcdef", "");
    expect(root).toContain('S=""');
  });
});
