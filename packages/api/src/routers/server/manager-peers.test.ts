import { describe, expect, test } from "vite-plus/test";

import { egressProbeScript, managerPeerScript } from "./manager-peers";

describe("managerPeerScript", () => {
  test("adds the address to the running set and persists it", () => {
    const script = managerPeerScript(["10.1.2.3"]);
    expect(script).toContain("nft add element inet otterdeploy otterdeploy_peers { 10.1.2.3 }");
    expect(script).toContain("/etc/nftables-otterdeploy.conf");
    expect(script).toContain("elements = {");
  });

  test("validates the edited ruleset and reverts it if it would not parse", () => {
    const script = managerPeerScript(["10.1.2.3"]);
    // Backup must be taken before the edit, and restored on a parse failure.
    // A corrupt ruleset here would lock the operator out of the manager.
    expect(script.indexOf(".bak")).toBeLessThan(script.indexOf("sed -i"));
    expect(script).toContain("nft -c -f");
    expect(script).toContain("peer-persist-reverted");
  });

  test("tolerates an install with no peer set instead of failing the run", () => {
    expect(managerPeerScript(["10.1.2.3"])).toContain("peer-set-absent");
  });

  test("never lets a non-IPv4 value reach the shell", () => {
    // The runOnHost contract is fixed, trusted text; anything that isn't a bare
    // IPv4 literal must be dropped rather than interpolated.
    const hostile = ["1.2.3.4; rm -rf /", "$(id)", "`id`", "example.com", "2a01:4f8:c014::1", ""];
    const script = managerPeerScript(hostile);
    expect(script).toBe("");
  });

  test("keeps the IPv4 in a host:port pair and drops the port", () => {
    const script = managerPeerScript(["10.1.2.3:2377"]);
    expect(script).toContain("{ 10.1.2.3 }");
    expect(script).not.toContain("2377 }");
  });

  test("returns empty when there is nothing safe to add", () => {
    expect(managerPeerScript([])).toBe("");
    expect(managerPeerScript(["not-an-ip"])).toBe("");
  });

  test("the persist loop cannot abort under set -e when the address is absent", () => {
    // `grep -qF … && continue` would exit the script on the not-found path,
    // which is the case that actually needs the sed to run.
    const script = managerPeerScript(["10.1.2.3"]);
    expect(script).toContain("if ! grep -qF");
    expect(script).not.toContain("&& continue");
  });

  test("dedupes so an address is not added twice", () => {
    const script = managerPeerScript(["10.1.2.3", "10.1.2.3"]);
    expect(script).toContain("{ 10.1.2.3 }");
  });
});

describe("egressProbeScript", () => {
  test("asks the node for the source it would use to reach the manager", () => {
    const script = egressProbeScript("188.34.155.133");
    expect(script).toContain("ip route get 188.34.155.133");
    expect(script).toContain("src");
  });
});
