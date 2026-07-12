/**
 * Pure decision/arg builders for the volume backup path. The daemon-facing
 * side (helper runs, archive extraction) is exercised against a real engine;
 * these lock the command lines, mount specs, key scoping, and the restore
 * in-use guard the engine relies on.
 */
import { describe, expect, it } from "vite-plus/test";

import {
  volumeArchiveScope,
  volumeClearArgs,
  volumeMountSpec,
  volumeRestoreBlockReason,
  volumeTarCreateArgs,
} from "../volume";

describe("volumeTarCreateArgs", () => {
  it("tars the mount root to stdout, including dotfiles", () => {
    expect(volumeTarCreateArgs()).toEqual(["tar", "cf", "-", "-C", "/v", "."]);
  });
});

describe("volumeClearArgs", () => {
  it("deletes everything under the mount root but not the root itself", () => {
    expect(volumeClearArgs()).toEqual(["find", "/v", "-mindepth", "1", "-delete"]);
  });
});

describe("volumeMountSpec", () => {
  it("claims the volume read-only for backups", () => {
    expect(volumeMountSpec("otterdeploy-pgdata-shop-main", { readOnly: true })).toEqual({
      Type: "volume",
      Source: "otterdeploy-pgdata-shop-main",
      Target: "/v",
      ReadOnly: true,
    });
  });

  it("claims the volume read-write for restores", () => {
    expect(volumeMountSpec("data", { readOnly: false }).ReadOnly).toBe(false);
  });
});

describe("volumeArchiveScope", () => {
  it("namespaces volume archives apart from resource-id scopes", () => {
    expect(volumeArchiveScope("pgdata")).toBe("volume-pgdata");
  });
});

describe("volumeRestoreBlockReason", () => {
  it("allows restore when nothing mounts the volume", () => {
    expect(volumeRestoreBlockReason([])).toBeNull();
  });

  it("refuses with the mounting container names", () => {
    const reason = volumeRestoreBlockReason(["shop-db", "shop-db-sidecar"]);
    expect(reason).toContain("shop-db, shop-db-sidecar");
    expect(reason).toContain("stop and remove");
  });

  it("truncates long mounter lists with a count", () => {
    const reason = volumeRestoreBlockReason(["a", "b", "c", "d", "e"]);
    expect(reason).toContain("a, b, c");
    expect(reason).toContain("and 2 more");
  });
});
