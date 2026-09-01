/* oxlint-disable node/no-process-env -- the override IS the interface under test: deploy-time wiring read raw, like HOST_PROC_PATH */
import { mkdtempSync, writeFileSync } from "node:fs";
import { hostname as osHostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { hostHostname } from "./host-identity";

// The override is deploy-time wiring (docker-compose.prod.yml); the test
// points it at a temp file the way the compose file points it at the host's
// /etc/hostname bind mount.
afterEach(() => {
  delete process.env.HOST_HOSTNAME_PATH;
});

describe("hostHostname", () => {
  it("returns the host's name from the mounted file", () => {
    const dir = mkdtempSync(join(tmpdir(), "host-identity-"));
    const file = join(dir, "hostname");
    writeFileSync(file, "hel-1\n");
    process.env.HOST_HOSTNAME_PATH = file;
    expect(hostHostname()).toBe("hel-1");
  });

  it("falls back to the process's own hostname when the file is empty or absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "host-identity-"));
    const empty = join(dir, "hostname");
    writeFileSync(empty, "\n");
    process.env.HOST_HOSTNAME_PATH = empty;
    expect(hostHostname()).toBe(osHostname());
    process.env.HOST_HOSTNAME_PATH = join(dir, "nope");
    expect(hostHostname()).toBe(osHostname());
  });
});
