/**
 * The builder runs in the server image's `runtime` stage (apps/server/Dockerfile),
 * and so does `railpack prepare`. What prepare shells out to has to exist there.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** apps/server/Dockerfile, found by walking up from this file, so the test
 *  also resolves when run from a compiled copy (tsc -b emits dist/). */
function dockerfilePath(): string {
  let dir = import.meta.dir;
  while (!existsSync(join(dir, "apps", "server", "Dockerfile"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("apps/server/Dockerfile not found above this test");
    dir = parent;
  }
  return join(dir, "apps", "server", "Dockerfile");
}

const DOCKERFILE = dockerfilePath();

/** The `runtime` stage's lines, `\`-continuations joined into one logical line. */
function runtimeStageInstructions(): string[] {
  const joined = readFileSync(DOCKERFILE, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .replaceAll(/\\\n/g, " ");
  const lines = joined.split("\n").map((line) => line.trim());
  const start = lines.findIndex((line) => /^FROM\s+\S+\s+AS\s+runtime$/i.test(line));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^FROM\s/i.test(line));
  return start === -1 ? [] : end === -1 ? rest : rest.slice(0, end);
}

/** Packages every `apk add` in the runtime stage installs. */
function runtimeApkPackages(): string[] {
  return runtimeStageInstructions()
    .filter((line) => line.startsWith("RUN apk add"))
    .flatMap((line) => line.replace(/^RUN apk add/, "").split(/\s+/))
    .filter((word) => word.length > 0 && !word.startsWith("-"));
}

describe("builder image (apps/server/Dockerfile runtime stage)", () => {
  test("railpack itself is installed in the runtime stage", () => {
    expect(
      runtimeStageInstructions().some((line) => line.includes("/usr/local/bin/railpack")),
    ).toBe(true);
  });

  // Railpack resolves a Python version through mise's pyenv plugin,
  // whose `python-build --definitions` is a bash script. Without bash in the
  // image every Python app failed at `railpack prepare` with
  // `env: can't execute 'bash'`.
  test("ships bash for mise's python-build during railpack prepare", () => {
    expect(runtimeApkPackages()).toContain("bash");
  });

  test("keeps the tools the builder shells out to", () => {
    expect(runtimeApkPackages()).toEqual(
      expect.arrayContaining(["git", "docker-cli", "docker-cli-buildx", "tar"]),
    );
  });
});
