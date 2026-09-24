import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

/**
 * One context per control plane.
 *
 * The bug these pin: `--url` was honoured everywhere while the token came off a
 * separate ladder that never looked at the host, so pointing a command at a
 * second control plane sent it the FIRST one's bearer token. The tests below
 * are mostly one assertion — that a host's URL and its credential can only be
 * resolved together.
 */

let dir: string;

/* oxlint-disable node/no-process-env -- seeds the var config.ts reads at import time */
function setConfigDir(value: string): void {
  process.env.OTTERDEPLOY_CONFIG_DIR = value;
}
function clearConfigDir(): void {
  delete process.env.OTTERDEPLOY_CONFIG_DIR;
  delete process.env.OTTERDEPLOY_TOKEN;
  delete process.env.OTTERDEPLOY_URL;
}
function setEnv(key: "OTTERDEPLOY_TOKEN" | "OTTERDEPLOY_URL", value: string): void {
  process.env[key] = value;
}
/* oxlint-enable node/no-process-env */

// config.ts reads its directory from env at module load, so point it at a temp
// dir and re-import per test rather than writing to the developer's real
// ~/.config/otterdeploy.
async function freshConfigModule(seed?: unknown): Promise<typeof import("../config")> {
  dir = mkdtempSync(join(tmpdir(), "otterdeploy-ctx-test-"));
  setConfigDir(dir);
  if (seed !== undefined) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(seed, null, 2));
  }
  const mod: typeof import("../config") = await import(
    `../config?${Math.random().toString(36).slice(2)}`
  );
  return mod;
}

beforeEach(() => {
  clearConfigDir();
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  clearConfigDir();
});

const A = "https://a.example.com";
const B = "https://b.example.com";

describe("per-host contexts", () => {
  test("a second login adds a host rather than displacing the first", async () => {
    const { saveContext, setCurrent, resolveContext } = await freshConfigModule();

    saveContext(A, { token: "token-a", orgSlug: "acme" });
    setCurrent(A);
    saveContext(B, { token: "token-b", orgSlug: "praxly" });
    setCurrent(B);

    expect(resolveContext(A).token).toBe("token-a");
    expect(resolveContext(B).token).toBe("token-b");
  });

  test("--url carries that host's OWN token, never the current one's", async () => {
    // The regression. Before contexts this returned "token-a" for B, so the
    // CLI presented one operator's credential to another's control plane.
    const { saveContext, setCurrent, resolveContext } = await freshConfigModule();

    saveContext(A, { token: "token-a" });
    saveContext(B, { token: "token-b" });
    setCurrent(A);

    expect(resolveContext(B).token).toBe("token-b");
  });

  test("a host you have never signed into resolves no token at all", async () => {
    // Which is what makes `ensureAuthenticated` start a login for THAT host
    // instead of silently reusing a credential that cannot work there.
    const { saveContext, setCurrent, resolveContext } = await freshConfigModule();

    saveContext(A, { token: "token-a" });
    setCurrent(A);

    const unknown = resolveContext("https://never-seen.example.com");
    expect(unknown.url).toBe("https://never-seen.example.com");
    expect(unknown.token).toBeUndefined();
  });

  test("the org selection is scoped to the host it was made on", async () => {
    const { saveContext, setCurrent, resolveContext } = await freshConfigModule();

    saveContext(A, { token: "token-a", orgId: "org_a", orgSlug: "acme" });
    saveContext(B, { token: "token-b" });
    setCurrent(B);

    expect(resolveContext().orgSlug).toBeUndefined();
    expect(resolveContext(A).orgSlug).toBe("acme");
  });

  test("a bare host and a trailing slash are the same context", async () => {
    // Otherwise `login acme.com` and `login https://acme.com/` become two
    // entries for one control plane, each holding half the state.
    const { saveContext, resolveContext } = await freshConfigModule();

    saveContext("https://acme.com", { token: "token-acme" });

    expect(resolveContext("acme.com").token).toBe("token-acme");
    expect(resolveContext("https://acme.com/").token).toBe("token-acme");
  });

  test("signing out of one host leaves the others signed in", async () => {
    const { saveContext, setCurrent, resolveContext, clearConfig } = await freshConfigModule();

    saveContext(A, { token: "token-a" });
    saveContext(B, { token: "token-b" });
    setCurrent(B);

    clearConfig(B);

    expect(resolveContext(A).token).toBe("token-a");
    expect(resolveContext(B).token).toBeUndefined();
  });

  test("clearToken drops the credential but keeps the org selection", async () => {
    // So a re-login lands the operator back where they were.
    const { saveContext, setCurrent, resolveContext, clearToken } = await freshConfigModule();

    saveContext(A, { token: "token-a", orgSlug: "acme", webUrl: "https://app.a.example.com" });
    setCurrent(A);

    clearToken();

    const context = resolveContext(A);
    expect(context.token).toBeUndefined();
    expect(context.orgSlug).toBe("acme");
    expect(context.webUrl).toBe("https://app.a.example.com");
  });
});

describe("OTTERDEPLOY_TOKEN", () => {
  test("still wins for CI, against whichever host resolved", async () => {
    const { saveContext, setCurrent, resolveContext } = await freshConfigModule();
    saveContext(A, { token: "token-a" });
    setCurrent(A);

    setEnv("OTTERDEPLOY_TOKEN", "ci-token");

    expect(resolveContext().token).toBe("ci-token");
    expect(resolveContext(B).token).toBe("ci-token");
  });

  test("OTTERDEPLOY_URL selects the host when no flag is passed", async () => {
    const { saveContext, setCurrent, resolveContext } = await freshConfigModule();
    saveContext(A, { token: "token-a" });
    saveContext(B, { token: "token-b" });
    setCurrent(A);

    setEnv("OTTERDEPLOY_URL", B);

    expect(resolveContext().token).toBe("token-b");
  });
});

describe("migration from the single-control-plane config", () => {
  test("folds the flat shape into a context and keeps it current", async () => {
    const { resolveContext, loadConfig } = await freshConfigModule({
      url: A,
      token: "legacy-token",
      webUrl: "https://app.a.example.com",
      orgId: "org_legacy",
      orgSlug: "acme",
      hosts: [A],
    });

    expect(loadConfig().current).toBe(A);
    const context = resolveContext();
    expect(context.url).toBe(A);
    expect(context.token).toBe("legacy-token");
    expect(context.orgSlug).toBe("acme");
    expect(context.webUrl).toBe("https://app.a.example.com");
  });

  test("a flat config with no url contributes no context", async () => {
    // There is nothing to attribute the token to, and guessing a host for a
    // credential is exactly the mistake this module removes.
    const { loadConfig } = await freshConfigModule({ token: "orphan-token" });

    expect(loadConfig().contexts).toEqual({});
    expect(loadConfig().current).toBeUndefined();
  });

  test("the known-host list survives the migration", async () => {
    const { knownHosts } = await freshConfigModule({ url: A, token: "t", hosts: [A, B] });

    expect(knownHosts()).toEqual([A, B]);
  });
});
