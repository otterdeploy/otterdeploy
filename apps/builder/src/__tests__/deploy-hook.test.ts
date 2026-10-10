import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
/**
 * a hook is ONE exec-form command. mastodon's
 * `["bundle","exec","rails","db:prepare"]` must run `bundle` with its three
 * arguments, not `sh -c bundle`; its output must reach the deployment log;
 * and a failure must say why.
 *
 * the image's declared VOLUME paths are read from the built
 * image.
 *
 * Both run against a fake `docker` on PATH that records its argv and answers
 * as told, so what is asserted is the exact command line the builder spawns.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LogSink } from "../log-stream";

/* oxlint-disable node/no-process-env -- test env setup boundary: deploy-hook and image-volumes import the api's env-validating modules (satisfy the required vars before the dynamic imports below), and the fake docker is found through PATH and steered through env */
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
process.env.CORS_ORIGIN ??= "http://localhost:3000";

const { hookMaskedValues, hookRunArgs, runHookCommands } = await import("../deploy-hook");
const { readImageVolumes } = await import("../image-volumes");

const FAKE_DOCKER = `#!/bin/sh
if [ "$1" = "image" ]; then
  printf '%s\\n' "$FAKE_INSPECT_OUTPUT"
  exit "\${FAKE_EXIT:-0}"
fi
for arg in "$@"; do printf '%s\\n' "$arg"; done > "$FAKE_ARGS_FILE"
echo "== running migrations"
echo "migration failed: relation users exists" >&2
exit "\${FAKE_EXIT:-0}"
`;

let dir = "";
let savedPath = "";
const argsFile = () => join(dir, "args");

function setFake(env: Record<string, string>): void {
  for (const key of ["FAKE_EXIT", "FAKE_INSPECT_OUTPUT"]) delete process.env[key];
  process.env.FAKE_ARGS_FILE = argsFile();
  Object.assign(process.env, env);
}
/* oxlint-enable node/no-process-env */

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "fake-docker-"));
  writeFileSync(join(dir, "docker"), FAKE_DOCKER);
  chmodSync(join(dir, "docker"), 0o755);
  // oxlint-disable-next-line node/no-process-env -- the fake docker is found through PATH
  savedPath = process.env.PATH ?? "";
  // oxlint-disable-next-line node/no-process-env -- the fake docker is found through PATH
  process.env.PATH = `${dir}:${savedPath}`;
});

afterAll(() => {
  // oxlint-disable-next-line node/no-process-env -- restore PATH
  process.env.PATH = savedPath;
  rmSync(dir, { recursive: true, force: true });
});

function recordingSink(): LogSink & { lines: Array<{ stream: string; line: string }> } {
  const lines: Array<{ stream: string; line: string }> = [];
  return {
    lines,
    write: (stream, line) => lines.push({ stream, line }),
    system: (line) => lines.push({ stream: "system", line }),
    setPhase: () => undefined,
    close: () => Promise.resolve(),
  };
}

const deploymentId = createId(ID_PREFIX.deployment);
const hookArgs = (invocations: string[][], sink: LogSink) => ({
  phase: "pre-deploy" as const,
  invocations,
  image: "otterdeploy-local/mastodon:abc",
  deploymentId,
  envFile: "/tmp/env",
  networkName: "otterdeploy-mastodon",
  secrets: [],
  sink,
});

describe("runHookCommands", () => {
  test("an exec-form hook runs argv[0] as the entrypoint with the rest as its arguments", async () => {
    setFake({});
    const sink = recordingSink();
    const ran = await runHookCommands(hookArgs([["bundle", "exec", "rails", "db:prepare"]], sink));
    expect(ran.isOk()).toBe(true);
    const argv = readFileSync(argsFile(), "utf8").trimEnd().split("\n");
    expect(argv[argv.indexOf("--entrypoint") + 1]).toBe("bundle");
    expect(argv.slice(argv.indexOf("otterdeploy-local/mastodon:abc") + 1)).toEqual([
      "exec",
      "rails",
      "db:prepare",
    ]);
    // The hook's own output lands in the deployment log, line by line.
    expect(sink.lines).toContainEqual({ stream: "stdout", line: "== running migrations" });
  });

  test("a failing hook stops the deploy and its error carries the output", async () => {
    setFake({ FAKE_EXIT: "23" });
    const ran = await runHookCommands(
      hookArgs([["bundle", "exec", "rails", "db:prepare"]], recordingSink()),
    );
    expect(ran.isErr()).toBe(true);
    const message = ran.isErr() ? ran.error.message : "";
    expect(message).toContain("command exited 23: bundle exec rails db:prepare");
    expect(message).toContain("migration failed: relation users exists");
  });
});

describe("hook output masking", () => {
  test("masks long env values but leaves short ones, so the error stays readable", async () => {
    // A Django app: masking every value, `on` included, turned
    // "django.contrib.postgres" into "django.c***trib.postgres".
    const secrets = hookMaskedValues({
      DJANGO_LOAD_INITIAL_DATA: "on",
      DJANGO_ALLOWED_HOSTS: "*",
      DEBUG: "1",
      DB_PASSWORD: "relation",
    });
    expect(secrets).toEqual(["relation"]);
    setFake({ FAKE_EXIT: "1" });
    const ran = await runHookCommands({
      ...hookArgs([["python", "manage.py", "migrate"]], recordingSink()),
      secrets,
    });
    const message = ran.isErr() ? ran.error.message : "";
    expect(message).toContain("migration failed: *** users exists");
    expect(message).toContain("== running migrations");
  });
});

describe("hookRunArgs", () => {
  test("a shell line runs through sh -c once", () => {
    const args = hookRunArgs({
      phase: "post-deploy",
      deploymentId,
      index: 1,
      networkName: "net",
      envFile: "/tmp/env",
      image: "img",
      argv: ["sh", "-c", "a && b"],
    });
    expect(args[args.indexOf("--entrypoint") + 1]).toBe("sh");
    expect(args.slice(args.indexOf("img") + 1)).toEqual(["-c", "a && b"]);
  });
});

describe("readImageVolumes", () => {
  test("lists the paths the built image declares", async () => {
    setFake({ FAKE_INSPECT_OUTPUT: '{"/var/lib/gitea":{},"/data":{}}' });
    const read = await readImageVolumes("gitea:abc", recordingSink());
    expect(read.isOk() && read.value).toEqual(["/data", "/var/lib/gitea"]);
  });

  test("an image with no VOLUME declares none", async () => {
    setFake({ FAKE_INSPECT_OUTPUT: "null" });
    const read = await readImageVolumes("whoami:abc", recordingSink());
    expect(read.isOk() && read.value).toEqual([]);
  });

  test("an inspect failure fails the step rather than deploying without the volumes", async () => {
    setFake({ FAKE_INSPECT_OUTPUT: "Error: No such image", FAKE_EXIT: "1" });
    const read = await readImageVolumes("gone:abc", recordingSink());
    expect(read.isErr() && read.error.message).toContain("docker image inspect exited 1");
  });
});
