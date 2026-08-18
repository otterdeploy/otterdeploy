/**
 * Pure-function coverage for the volume file explorer: the path gate that
 * keeps user input inside the /v mount, and the BusyBox stat-line parser the
 * directory listing is built from. No daemon involved.
 */
import { describe, expect, test } from "vite-plus/test";

import { parseStatLine, parseVolumeDirListing, resolveVolumeExplorePath } from "../explore-parse";

describe("resolveVolumeExplorePath: accepts", () => {
  test("empty path is the volume root", () => {
    expect(resolveVolumeExplorePath("")).toEqual({
      ok: true,
      containerPath: "/v",
      relative: "",
    });
  });

  test("plain nested path", () => {
    expect(resolveVolumeExplorePath("data/conf.d/app.conf")).toEqual({
      ok: true,
      containerPath: "/v/data/conf.d/app.conf",
      relative: "data/conf.d/app.conf",
    });
  });

  test("normalizes ./, doubled and trailing slashes to one canonical key", () => {
    for (const raw of ["./a/b/", "a//b", "/a/b", "a/./b"]) {
      expect(resolveVolumeExplorePath(raw)).toEqual({
        ok: true,
        containerPath: "/v/a/b",
        relative: "a/b",
      });
    }
  });

  test("dotfiles and names merely containing dots pass", () => {
    expect(resolveVolumeExplorePath(".env")).toMatchObject({ ok: true, relative: ".env" });
    expect(resolveVolumeExplorePath("a/..b/c...d")).toMatchObject({
      ok: true,
      containerPath: "/v/a/..b/c...d",
    });
  });

  test("tilde beyond the first segment is a literal filename", () => {
    expect(resolveVolumeExplorePath("backup/~old")).toMatchObject({ ok: true });
  });
});

describe("resolveVolumeExplorePath: rejects", () => {
  test.each(["..", "a/../b", "../etc/passwd", "a/b/..", "/..", ".././x"])(
    "'..' traversal: %s",
    (raw) => {
      expect(resolveVolumeExplorePath(raw)).toMatchObject({ ok: false });
    },
  );

  test.each(["~", "~/secrets", "~root/.ssh"])("leading tilde: %s", (raw) => {
    expect(resolveVolumeExplorePath(raw)).toMatchObject({ ok: false });
  });

  test("NUL byte anywhere", () => {
    expect(resolveVolumeExplorePath("a/b\0c")).toMatchObject({ ok: false });
  });
});

describe("parseStatLine", () => {
  test("regular file", () => {
    expect(parseStatLine("/v/app.conf\tregular file\t1024\t1755300000\t644")).toEqual({
      path: "/v/app.conf",
      kind: "file",
      size: 1024,
      mtime: 1755300000,
      mode: "644",
    });
  });

  test("regular empty file is still a file", () => {
    expect(parseStatLine("/v/.keep\tregular empty file\t0\t1755300000\t644")).toMatchObject({
      kind: "file",
      size: 0,
    });
  });

  test("directory, symlink, and device kinds", () => {
    expect(parseStatLine("/v/data\tdirectory\t4096\t1755300000\t755")).toMatchObject({
      kind: "dir",
    });
    expect(parseStatLine("/v/link\tsymbolic link\t7\t1755300000\t777")).toMatchObject({
      kind: "symlink",
    });
    expect(parseStatLine("/v/dev\tcharacter special file\t0\t1755300000\t660")).toMatchObject({
      kind: "other",
    });
  });

  test("tab inside the filename survives (fields parse right-to-left)", () => {
    expect(parseStatLine("/v/weird\tname\tregular file\t12\t1755300000\t600")).toMatchObject({
      path: "/v/weird\tname",
      kind: "file",
      size: 12,
    });
  });

  test("sticky/setuid four-digit modes parse", () => {
    expect(parseStatLine("/v/tmp\tdirectory\t4096\t1755300000\t1777")).toMatchObject({
      mode: "1777",
    });
  });

  test("garbage fragments are dropped, not guessed at", () => {
    expect(parseStatLine("")).toBeNull();
    expect(parseStatLine("just some text")).toBeNull();
    // Numeric fields that aren't integers (e.g. shrapnel from a newline in a
    // filename shifting the columns).
    expect(parseStatLine("/v/x\tregular file\tabc\t1755300000\t644")).toBeNull();
    expect(parseStatLine("/v/x\tregular file\t10\t1755300000\tnot-octal")).toBeNull();
  });
});

describe("parseVolumeDirListing", () => {
  const stdout = [
    "/v/data\tdirectory\t4096\t1755300000\t755",
    "/v/data/b.txt\tregular file\t10\t1755300001\t644",
    "/v/data/sub\tdirectory\t4096\t1755300002\t755",
    "/v/data/a.txt\tregular file\t20\t1755300003\t600",
    "/v/data/zlink\tsymbolic link\t7\t1755300004\t777",
    "",
  ].join("\n");

  test("splits self from children and sorts directories first", () => {
    const listing = parseVolumeDirListing(stdout, "/v/data");
    expect(listing.self).toEqual({ kind: "dir" });
    expect(listing.entries.map((e) => e.name)).toEqual(["sub", "a.txt", "b.txt", "zlink"]);
  });

  test("missing self entry means the path did not resolve", () => {
    expect(parseVolumeDirListing("", "/v/data").self).toBeNull();
  });

  test("self can be a non-directory (caller navigated to a file)", () => {
    const listing = parseVolumeDirListing(
      "/v/notes.txt\tregular file\t9\t1755300000\t644",
      "/v/notes.txt",
    );
    expect(listing.self).toEqual({ kind: "file" });
    expect(listing.entries).toEqual([]);
  });

  test("lines outside the requested directory are ignored", () => {
    const listing = parseVolumeDirListing(
      ["/v/data\tdirectory\t4096\t1755300000\t755", "/v/other/x\tregular file\t1\t1\t644"].join(
        "\n",
      ),
      "/v/data",
    );
    expect(listing.entries).toEqual([]);
  });

  test("root listing strips the /v/ prefix", () => {
    const listing = parseVolumeDirListing(
      ["/v\tdirectory\t4096\t1\t755", "/v/etc\tdirectory\t4096\t1\t755"].join("\n"),
      "/v",
    );
    expect(listing.entries.map((e) => e.name)).toEqual(["etc"]);
  });
});
