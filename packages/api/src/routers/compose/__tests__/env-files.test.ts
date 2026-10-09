/**
 * env_file targets reach the service, from wherever the stack's files are.
 *
 * Immich's server reads its database password from
 * `env_file: .env`, which the repo ships only as `example.env`. Git stacks
 * never read env_file at all, and a missing one was skipped without a word,
 * so the server started on the image default while its Postgres was
 * initialised with the stack's password.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { parseCompose } from "../../../stack/compose";
import { applyEnvFiles, missingEnvFilesMessage } from "../env-files";

function parsed(yaml: string) {
  const r = parseCompose(yaml);
  if (r.isErr()) throw new Error(r.error.message);
  return r.value;
}

function env(stack: ReturnType<typeof parsed>, name: string): Record<string, string> {
  const svc = stack.services.find((s) => s.name === name);
  if (!svc) throw new Error(`service ${name} not found`);
  return svc.env;
}

/** Immich's docker/docker-compose.yml, cut to the env plumbing. */
const IMMICH = `
services:
  immich-server:
    image: ghcr.io/immich-app/immich-server:\${IMMICH_VERSION:-release}
    env_file:
      - .env
  database:
    image: ghcr.io/immich-app/postgres:14
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      POSTGRES_USER: \${DB_USERNAME}
      POSTGRES_DB: \${DB_DATABASE_NAME}
`;

const STACK_VARS = {
  IMMICH_VERSION: "v3.2.4",
  DB_PASSWORD: "from-the-stack",
  DB_USERNAME: "postgres",
  DB_DATABASE_NAME: "immich",
  UNRELATED_SECRET: "another stack's",
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "env-files-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("applyEnvFiles", () => {
  it("reads a git stack's env_file from the checkout, under the service's own environment", async () => {
    await writeFile(join(dir, "app.env"), "# comment\nLOG_LEVEL=debug\nPORT='8080'\nTZ=UTC\n");
    const stack = parsed(`
services:
  app:
    image: nginx
    env_file: app.env
    environment:
      TZ: Europe/Berlin
`);
    const outcome = await applyEnvFiles(stack, { dir, home: "repo", stackVars: {} });
    expect(outcome).toEqual({ notes: [], missing: [] });
    expect(env(stack, "app")).toEqual({ LOG_LEVEL: "debug", PORT: "8080", TZ: "Europe/Berlin" });
  });

  it("stands the stack's variables in for a .env the repo does not ship", async () => {
    const stack = parsed(IMMICH);
    const outcome = await applyEnvFiles(stack, { dir, home: "repo", stackVars: STACK_VARS });
    expect(outcome.missing).toEqual([]);
    // The server now gets the same password its database was initialised
    // with, and only the variables this stack's file interpolates.
    expect(env(stack, "immich-server")).toEqual({
      IMMICH_VERSION: "v3.2.4",
      DB_PASSWORD: "from-the-stack",
      DB_USERNAME: "postgres",
      DB_DATABASE_NAME: "immich",
    });
    expect(outcome.notes).toEqual([
      "immich-server: no .env in the repo; using the stack's variables (DB_DATABASE_NAME, DB_PASSWORD, DB_USERNAME, IMMICH_VERSION)",
    ]);
  });

  it("reads a .env the repo does ship, as compose would", async () => {
    await writeFile(join(dir, ".env"), "DB_PASSWORD=from-the-file\n");
    const stack = parsed(IMMICH);
    await applyEnvFiles(stack, { dir, home: "repo", stackVars: STACK_VARS });
    expect(env(stack, "immich-server")).toEqual({ DB_PASSWORD: "from-the-file" });
  });

  it("reports a required env_file that is not there instead of skipping it", async () => {
    const stack = parsed(`
services:
  app:
    image: nginx
    env_file: [config/app.env]
`);
    const outcome = await applyEnvFiles(stack, { dir, home: "repo", stackVars: {} });
    expect(outcome.missing).toEqual([{ service: "app", path: "config/app.env" }]);
    expect(missingEnvFilesMessage(outcome.missing, "repo")).toBe(
      "These env_file targets are not in the repo: app → config/app.env. " +
        "Compose refuses a missing env_file too. Add the file, or mark the entry `required: false`.",
    );
  });

  it("skips an optional env_file with a note", async () => {
    const stack = parsed(`
services:
  app:
    image: nginx
    env_file:
      - path: ./local.env
        required: false
`);
    const outcome = await applyEnvFiles(stack, { dir, home: "stack files", stackVars: {} });
    expect(outcome).toEqual({
      notes: ["app: optional env_file ./local.env not in the stack files"],
      missing: [],
    });
  });

  it("never reads outside the stack's tree", async () => {
    const stack = parsed(`
services:
  app:
    image: nginx
    env_file: ../../etc/environment
`);
    const outcome = await applyEnvFiles(stack, { dir, home: "repo", stackVars: {} });
    expect(outcome.missing).toEqual([{ service: "app", path: "../../etc/environment" }]);
    expect(env(stack, "app")).toEqual({});
  });

  it("treats a single-file stack's targets as absent", async () => {
    const stack = parsed(IMMICH);
    const outcome = await applyEnvFiles(stack, {
      dir: undefined,
      home: "stack files",
      stackVars: STACK_VARS,
    });
    expect(outcome.missing).toEqual([]);
    expect(env(stack, "immich-server").DB_PASSWORD).toBe("from-the-stack");
  });
});
