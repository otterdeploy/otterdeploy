import { Hono } from "hono";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

import { createInstallNodeHandler } from "../install-node";

const ORIGIN = "https://deploy.example";
const TOKEN = `nen_${"a".repeat(24)}.${"x".repeat(43)}`;

function app() {
  const hono = new Hono();
  hono.get(
    "/install-node.sh",
    createInstallNodeHandler(async () => ORIGIN),
  );
  return hono;
}

async function fetchScript(): Promise<Response> {
  return app().request("/install-node.sh");
}

/** Run the served script the way the dialog's command does (`sh -s -- …`),
 *  with curl replaced by a stand-in that records its arguments and hands back
 *  a one-line "installer". */
function run(script: string, args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "install-node-"));
  const log = join(dir, "curl.log");
  const stub = `curl() { printf '%s\\n' "$*" > '${log}'; printf 'echo installer-ran'; }`;
  const result = spawnSync("sh", ["-c", `${stub}\n. /dev/stdin`, "sh", ...args], {
    input: script,
    encoding: "utf8",
  });
  const curl = existsSync(log) ? readFileSync(log, "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  return { ...result, curl };
}

describe("GET /install-node.sh", () => {
  test("serves a shell script", async () => {
    const res = await fetchScript();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/x-shellscript/);
    expect((await res.text()).startsWith("#!/bin/sh\n")).toBe(true);
  });

  test("needs no credential to fetch: the token travels as an argument", async () => {
    const res = await app().request("/install-node.sh", { headers: {} });
    expect(res.status).toBe(200);
  });

  test("refuses to run without a token", async () => {
    const script = await (await fetchScript()).text();
    const result = run(script, []);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--token");
    expect(result.stdout).not.toContain("installer-ran");
  });

  test("refuses a token that is not an install token", async () => {
    const script = await (await fetchScript()).text();
    const result = run(script, ["--token", "not-a-token"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("installer-ran");
  });

  test("redeems the token at this control plane and runs what comes back", async () => {
    const script = await (await fetchScript()).text();
    const result = run(script, ["--token", TOKEN]);
    expect(result.status).toBe(0);
    expect(result.curl).toContain(
      `-X POST ${ORIGIN}/api/node-enrollments/nen_${"a".repeat(24)}/redeem`,
    );
    expect(result.curl).toContain(`Authorization: Bearer ${TOKEN}`);
    expect(result.stdout).toContain("installer-ran");
  });
});
