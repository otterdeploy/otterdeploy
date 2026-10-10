/**
 * `otd logout` revokes the session on the server, then clears the
 * local credentials. It used to delete the local config only, so the device
 * login's bearer token stayed valid until it expired: a copy of it (a backed
 * up ~/.config, a CI log) kept working after the user "logged out".
 *
 * The real binary is spawned (bun src/index.ts) against a loopback control
 * plane that records what reaches it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

const CLI_ENTRY = join(import.meta.dirname, "..", "index.ts");
const scratch = mkdtempSync(join(tmpdir(), "logout-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const TOKEN = "session_token_logout_probe";

/** Writes a logged-in config and runs `otterdeploy logout` against `url`. */
async function logout(url: string) {
  const dir = mkdtempSync(join(scratch, "run-"));
  const configDir = join(dir, ".config");
  mkdirSync(configDir, { recursive: true });
  const configFile = join(configDir, "config.json");
  writeFileSync(configFile, JSON.stringify({ url, token: TOKEN, hosts: [url] }));
  // oxlint-disable-next-line node/no-process-env -- test boundary: the spawned CLI inherits PATH/HOME like a user's shell
  const { OTTERDEPLOY_TOKEN: _t, OTTERDEPLOY_URL: _u, ...inherited } = process.env;
  const child = Bun.spawn(["bun", CLI_ENTRY, "logout"], {
    cwd: dir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...inherited, OTTERDEPLOY_CONFIG_DIR: configDir, NO_COLOR: "1", CI: "1" },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const left: unknown = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
  return { exitCode, output: `${stdout}${stderr}`, left };
}

describe("otd logout", () => {
  it("revokes the session on the server with its bearer, then clears the local token", async () => {
    const seen: Array<{ path: string; method: string; authorization: string | null }> = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        seen.push({
          path: new URL(request.url).pathname,
          method: request.method,
          authorization: request.headers.get("authorization"),
        });
        return Response.json({ success: true });
      },
    });
    try {
      const url = `http://127.0.0.1:${server.port}`;
      const run = await logout(url);
      expect(run.exitCode, run.output).toBe(0);
      expect(seen).toContainEqual({
        path: "/api/auth/sign-out",
        method: "POST",
        authorization: `Bearer ${TOKEN}`,
      });
      expect(run.left).toEqual({ hosts: [url] });
      expect(run.output).toMatch(/revoked on the server/);
    } finally {
      await server.stop(true);
    }
  });

  it("with the server unreachable, still clears locally and says the session could not be revoked", async () => {
    // A port nothing listens on: bind one, then close it.
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
    const url = `http://127.0.0.1:${probe.port}`;
    await probe.stop(true);

    const run = await logout(url);
    expect(run.exitCode, run.output).toBe(0);
    expect(run.left).toEqual({ hosts: [url] });
    expect(run.output).toMatch(/could not be revoked/);
  });

  it("with a server that never answers, gives up after its timeout and still logs out", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      // Accepts the request and never responds.
      fetch: () => new Promise<Response>(() => {}),
    });
    try {
      const url = `http://127.0.0.1:${server.port}`;
      const started = performance.now();
      const run = await logout(url);
      expect(run.exitCode, run.output).toBe(0);
      expect(performance.now() - started).toBeLessThan(15_000);
      expect(run.left).toEqual({ hosts: [url] });
      expect(run.output).toMatch(/could not be revoked/);
    } finally {
      await server.stop(true);
    }
  }, 20_000);
});
