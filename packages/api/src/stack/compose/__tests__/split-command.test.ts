/**
 * A string `command:` in Compose is word-split into argv — it is NOT wrapped in
 * `/bin/sh -c`. That wrapping is DOCKERFILE shell-form semantics, and applying
 * it here broke every image carrying its own ENTRYPOINT: the wrapper became the
 * entrypoint's first argument. Authentik (`command: server`, entrypoint
 * `dumb-init -- ak`) ran `ak /bin/sh -c server`, died on
 * "Unknown command: '/bin/sh'", and restart-looped.
 */

import { describe, expect, it } from "vite-plus/test";

import { splitCommandString } from "../command-string";
import { parseCompose } from "../parse";

describe("splitCommandString", () => {
  it("splits a bare command", () => {
    expect(splitCommandString("server")).toEqual(["server"]);
  });

  it("splits flags and paths", () => {
    expect(splitCommandString("server /data --console-address :9001")).toEqual([
      "server",
      "/data",
      "--console-address",
      ":9001",
    ]);
  });

  it("keeps a double-quoted value as ONE argument, without the quotes", () => {
    // MinIO's real command. Splitting on whitespace alone would hand the image
    // a literal `":9001"` including quote characters.
    expect(splitCommandString('server /data --console-address ":9001"')).toEqual([
      "server",
      "/data",
      "--console-address",
      ":9001",
    ]);
  });

  it("keeps a quoted shell script intact for an explicit sh -c", () => {
    // Plausible's shape: the operator asked for a shell, so they get exactly
    // one — not a shell inside the shell we used to add.
    expect(splitCommandString('sh -c "db migrate && run"')).toEqual([
      "sh",
      "-c",
      "db migrate && run",
    ]);
  });

  it("handles single quotes and escapes", () => {
    expect(splitCommandString("echo 'a b'")).toEqual(["echo", "a b"]);
    expect(splitCommandString("echo a\\ b")).toEqual(["echo", "a b"]);
  });

  it("preserves an intentionally empty argument", () => {
    expect(splitCommandString('listmonk --config ""')).toEqual(["listmonk", "--config", ""]);
  });

  it("collapses runs of whitespace", () => {
    expect(splitCommandString("  a   b  ")).toEqual(["a", "b"]);
  });
});

describe("compose command parsing", () => {
  const parsed = (command: string) =>
    parseCompose(`name: t\nservices:\n  app:\n    image: x\n    command: ${command}\n`);

  it("never emits a /bin/sh -c wrapper for a string command", () => {
    const r = parsed("server");
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.services[0]?.command).toEqual(["server"]);
  });

  it("leaves an array command exactly as written", () => {
    const r = parseCompose(
      `name: t\nservices:\n  app:\n    image: x\n    command: ["sh", "-c", "echo hi"]\n`,
    );
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.services[0]?.command).toEqual(["sh", "-c", "echo hi"]);
  });
});
