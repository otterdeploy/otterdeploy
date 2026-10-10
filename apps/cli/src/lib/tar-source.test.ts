import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createSourceTarball, tarEnv } from "./tar-source";

/** Entry names straight from the tar headers (a macOS `tar -t` folds the
 *  AppleDouble `._*` entries back into their files, hiding them). */
function entryNames(archive: string): string[] {
  const tar = gunzipSync(readFileSync(archive));
  const names: string[] = [];
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    const field = header.subarray(0, 100);
    const nul = field.indexOf(0);
    const name = field.subarray(0, nul === -1 ? field.length : nul).toString("utf8");
    if (!name) break;
    const size = Number.parseInt(header.subarray(124, 136).toString("utf8").trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0);
    // pax headers (x/g) describe the next entry; they are not files.
    if (type !== "x" && type !== "g") names.push(name.replace(/^\.\//, ""));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

describe("createSourceTarball", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it("turns off bsdtar's AppleDouble copies", () => {
    expect(tarEnv().COPYFILE_DISABLE).toBe("1");
  });

  it.runIf(process.platform === "darwin")(
    "never ships macOS AppleDouble ._ files for files with extended attributes",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "tar-source-"));
      made.push(dir);
      writeFileSync(join(dir, "app.csproj"), "<Project />\n");
      writeFileSync(join(dir, "global.json"), "{}\n");
      for (const file of ["app.csproj", "global.json"]) {
        execFileSync("xattr", ["-w", "com.otterdeploy.test", "x", join(dir, file)]);
      }

      const archive = createSourceTarball(dir, `test-${randomUUID()}`);
      made.push(archive);

      const names = entryNames(archive);
      expect(names).toContain("app.csproj");
      expect(names).toContain("global.json");
      expect(names.filter((n) => n.split("/").pop()?.startsWith("._"))).toEqual([]);
    },
  );
});
