import { describe, expect, test } from "vite-plus/test";

import { daemonVersionToWrite } from "../agent-ingest";
import { hostMountSources, parseProcMounts } from "../proc-filesystems";

/**
 * The server page's facts must be the HOST's, not the health agent
 * container's, and must not be blank when the daemon told us the answer.
 */

describe("host filesystems", () => {
  test("Docker's per-container file binds are not host disks", () => {
    // What /proc/self/mounts shows inside any container: the three files
    // Docker bind-mounts in, on the host's disk device. Listing them as the
    // node's filesystems is the bug the review box showed.
    const containerMounts = [
      "overlay / overlay rw 0 0",
      "/dev/sda1 /etc/resolv.conf ext4 rw 0 0",
      "/dev/sda1 /etc/hostname ext4 rw 0 0",
      "/dev/sda1 /etc/hosts ext4 rw 0 0",
    ].join("\n");
    expect(parseProcMounts(containerMounts)).toEqual([]);
  });

  test("a containerised reader takes the host's mount table from pid 1, then falls back", () => {
    // `<proc>/mounts` is a symlink to `self/mounts`: the READER's mount
    // namespace. With the host's /proc bind-mounted, pid 1 is the host's init.
    expect(hostMountSources("/host/proc")).toEqual({
      tables: ["/host/proc/1/mounts", "/host/proc/mounts"],
      // statfs has to go through the host's root too, or it measures the
      // container's own overlay at the same path.
      statPath: expect.any(Function),
    });
    expect(hostMountSources("/host/proc").statPath("/var")).toBe("/host/proc/1/root/var");
    expect(hostMountSources("/host/proc").statPath("/")).toBe("/host/proc/1/root/");
  });

  test("a reader on the host itself reads its own table and paths", () => {
    const sources = hostMountSources("/proc");
    expect(sources.tables).toEqual(["/proc/mounts"]);
    expect(sources.statPath("/var")).toBe("/var");
  });
});

describe("daemonVersionToWrite", () => {
  test("writes the engine version a report carries when the row lacks it or is stale", () => {
    expect(daemonVersionToWrite(null, { dockerVersion: "29.0.1" })).toBe("29.0.1");
    expect(daemonVersionToWrite("28.5.0", { dockerVersion: "29.0.1" })).toBe("29.0.1");
  });

  test("leaves the row alone when nothing changed or the report has no version", () => {
    expect(daemonVersionToWrite("29.0.1", { dockerVersion: "29.0.1" })).toBeNull();
    // An older agent posts no version, and a daemon that did not answer posts
    // null: neither may blank a version we already know.
    expect(daemonVersionToWrite("29.0.1", {})).toBeNull();
    expect(daemonVersionToWrite("29.0.1", { dockerVersion: null })).toBeNull();
    expect(daemonVersionToWrite(null, { dockerVersion: "  " })).toBeNull();
  });
});
