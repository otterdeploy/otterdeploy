import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

/**
 * The login pick-list is only as good as the history behind it. These pin the
 * two behaviours that make it useful: most-recent-first ordering (so the
 * control plane you actually use is the default selection), and surviving
 * `logout`, signing out shouldn't cost you the domains you know.
 */

let dir: string;

/**
 * This suite's only environment boundary, kept in one place. `config.ts`
 * resolves its directory from `OTTERDEPLOY_CONFIG_DIR` at module load, so the
 * tests have to *write* the variable before re-importing it. A write can't go
 * through the validated `@otterdeploy/env` object, which only reads.
 */
/* oxlint-disable node/no-process-env -- seeds the var config.ts reads at import time */
function setConfigDir(value: string): void {
  process.env.OTTERDEPLOY_CONFIG_DIR = value;
}

function clearConfigDir(): void {
  delete process.env.OTTERDEPLOY_CONFIG_DIR;
}
/* oxlint-enable node/no-process-env */

// config.ts reads its directory from env at module load, so point it at a temp
// dir and re-import per test rather than writing to the developer's real
// ~/.config/otterdeploy.
async function freshConfigModule() {
  dir = mkdtempSync(join(tmpdir(), "otterdeploy-cli-test-"));
  setConfigDir(dir);
  const mod = await import(`../config?${Math.random().toString(36).slice(2)}`);
  return mod as typeof import("../config");
}

beforeEach(() => {
  clearConfigDir();
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  clearConfigDir();
});

describe("known hosts", () => {
  test("records logins most-recent-first, without duplicates", async () => {
    const { rememberHost, knownHosts } = await freshConfigModule();

    rememberHost("https://a.example.com");
    rememberHost("https://b.example.com");
    rememberHost("https://a.example.com"); // re-login to the first one

    expect(knownHosts()).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  test("survives logout, while the token does not", async () => {
    const { rememberHost, knownHosts, saveConfig, loadConfig, clearConfig } =
      await freshConfigModule();

    rememberHost("https://deploy.acme.com");
    saveConfig({ ...loadConfig(), token: "secret-token", url: "https://deploy.acme.com" });

    clearConfig();

    expect(knownHosts()).toEqual(["https://deploy.acme.com"]);
    expect(loadConfig().token).toBeUndefined();
    expect(loadConfig().url).toBeUndefined();
  });

  test("caps the list so it stays a usable pick-list", async () => {
    const { rememberHost, knownHosts } = await freshConfigModule();

    for (let i = 0; i < 15; i++) rememberHost(`https://host-${i}.example.com`);

    const hosts = knownHosts();
    expect(hosts).toHaveLength(10);
    expect(hosts[0]).toBe("https://host-14.example.com"); // newest kept
    expect(hosts).not.toContain("https://host-0.example.com"); // oldest dropped
  });
});
