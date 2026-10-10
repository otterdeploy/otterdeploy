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

/** Packages every `apt-get install` in the runtime stage installs. */
function runtimeAptPackages(): string[] {
  return runtimeStageInstructions()
    .flatMap((line) => line.split("&&").map((part) => part.trim()))
    .map((part) => part.replace(/^RUN\s+/, ""))
    .filter((part) => part.startsWith("apt-get install"))
    .flatMap((part) => part.replace(/^apt-get install/, "").split(/\s+/))
    .filter((word) => word.length > 0 && !word.startsWith("-"));
}

/** The runtime stage's base image, e.g. `oven/bun:${BUN_VERSION}-slim`. */
function runtimeBaseImage(): string {
  const joined = readFileSync(DOCKERFILE, "utf8");
  return /^FROM\s+(\S+)\s+AS\s+runtime$/im.exec(joined)?.[1] ?? "";
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
    expect(runtimeAptPackages()).toContain("bash");
  });

  // railpack always runs the musl mise, and mise only lists builds
  // for the libc it detects. On alpine a JDK with no musl build (Railpack's
  // default java@21) resolved to nothing, so every Java app without a pinned JDK
  // failed at prepare with "Failed to resolve version 21 of java". Prepare must
  // run on glibc, the libc of the image Railpack builds in.
  test("runs railpack prepare on a glibc (Debian) base, not alpine", () => {
    const base = runtimeBaseImage();
    expect(base).toMatch(/^oven\/bun:\$\{BUN_VERSION\}-(slim|debian)$/);
    expect(base).not.toContain("alpine");
    expect(runtimeStageInstructions().some((line) => line.startsWith("RUN apk"))).toBe(false);
  });

  test("keeps the tools the builder shells out to", () => {
    expect(runtimeAptPackages()).toEqual(expect.arrayContaining(["git", "tar"]));
    const steps = runtimeStageInstructions();
    expect(steps.some((line) => line.includes("/usr/local/bin/docker "))).toBe(true);
    expect(
      steps.some((line) => line.includes("/usr/local/lib/docker/cli-plugins/docker-buildx")),
    ).toBe(true);
  });
});
