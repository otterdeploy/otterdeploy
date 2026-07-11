import { describe, expect, test } from "vite-plus/test";

import {
  authorizedKeyScript,
  cloudflaredInstallScript,
  dockerInstallScript,
  meshInstallScript,
  parseMeshAddress,
  parseProbe,
  prereqScript,
  probeScript,
  swarmJoinScript,
} from "../provision";

describe("parseProbe", () => {
  test("parses all markers", () => {
    const out = [
      "some noise",
      "OTTER_OS_ID=ubuntu",
      "OTTER_HOSTNAME=prod-04",
      "OTTER_PRIV=sudo",
      "OTTER_DOCKER=27.1.1",
      "OTTER_SWARM=inactive",
      "trailing",
    ].join("\n");
    expect(parseProbe(out)).toEqual({
      osId: "ubuntu",
      hostname: "prod-04",
      privilege: "sudo",
      docker: "27.1.1",
      swarmState: "inactive",
    });
  });

  test("defaults missing markers and unknown privilege to none", () => {
    expect(parseProbe("OTTER_PRIV=weird")).toEqual({
      osId: "unknown",
      hostname: "unknown",
      privilege: "none",
      docker: "none",
      swarmState: "unknown",
    });
  });

  test("recognises root privilege", () => {
    expect(parseProbe("OTTER_PRIV=root").privilege).toBe("root");
  });
});

describe("script builders", () => {
  test("probe emits the four markers", () => {
    const s = probeScript();
    for (const k of ["OTTER_OS_ID", "OTTER_PRIV", "OTTER_DOCKER", "OTTER_SWARM"]) {
      expect(s).toContain(k);
    }
  });

  test("prereq/docker prefix commands with sudo when given", () => {
    expect(prereqScript("sudo")).toContain("sudo apt-get update");
    expect(dockerInstallScript("sudo")).toContain("| sudo sh");
  });

  test("prereq/docker run bare as root (no sudo prefix)", () => {
    expect(prereqScript("")).toContain("apt-get install -y $PKGS");
    expect(prereqScript("")).not.toContain("sudo ");
    expect(dockerInstallScript("")).toContain("| sh");
    expect(dockerInstallScript("")).not.toContain("sudo");
  });

  test("swarm join leaves an existing swarm then joins with token + addr", () => {
    const s = swarmJoinScript("TKN-abc", "10.0.0.1:2377", "");
    expect(s).toContain("docker swarm leave --force");
    expect(s).toContain("docker swarm join --token TKN-abc 10.0.0.1:2377");
    expect(s).not.toContain("--advertise-addr");
  });

  test("swarm join advertises the mesh address when given", () => {
    const s = swarmJoinScript("TKN", "100.64.0.1:2377", "sudo", "100.64.0.9");
    expect(s).toContain(
      "docker swarm join --token TKN --advertise-addr 100.64.0.9 100.64.0.1:2377",
    );
  });

  test("tailscale mesh installs + brings up + echoes the mesh IP", () => {
    const s = meshInstallScript("tailscale", "tskey-abc", "sudo");
    expect(s).toContain("tailscale.com/install.sh");
    expect(s).toContain("tailscale up --authkey='tskey-abc'");
    expect(s).toContain("tailscale ip -4");
    expect(s).toContain("OTTER_MESH_IP=");
  });

  test("netbird mesh uses the setup key + wt0 interface, with optional mgmt url", () => {
    const s = meshInstallScript("netbird", "nb-setup", "", "https://nb.example.com");
    expect(s).toContain("pkgs.netbird.io/install.sh");
    expect(s).toContain(
      "netbird up --setup-key 'nb-setup' --management-url https://nb.example.com",
    );
    expect(s).toContain("addr show wt0");
  });

  test("parseMeshAddress extracts the IP, null when empty", () => {
    expect(parseMeshAddress("noise\nOTTER_MESH_IP=100.64.0.9\nmore")).toBe("100.64.0.9");
    expect(parseMeshAddress("OTTER_MESH_IP=")).toBeNull();
    expect(parseMeshAddress("nothing here")).toBeNull();
  });

  test("cloudflared runs the tunnel container with the token", () => {
    const s = cloudflaredInstallScript("cf-token-123", "sudo");
    expect(s).toContain("cloudflare/cloudflared:latest");
    expect(s).toContain("tunnel --no-autoupdate run --token cf-token-123");
    expect(s).toContain("sudo docker run -d --name otter-cloudflared");
  });

  test("authorized key is appended idempotently", () => {
    const s = authorizedKeyScript("ssh-ed25519 AAAAC3 comment");
    expect(s).toContain("KEY='ssh-ed25519 AAAAC3 comment'");
    expect(s).toContain("grep -qxF");
    expect(s).toContain(">> ~/.ssh/authorized_keys");
  });
});
