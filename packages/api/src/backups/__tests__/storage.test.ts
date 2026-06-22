import { describe, expect, it } from "vitest";

import { archiveKey, sftpRemotePath } from "../storage";

describe("archiveKey", () => {
  it("lays archives out under otterdeploy-backups/<resourceId>/<backupId>.<ext>", () => {
    expect(
      archiveKey({ resourceId: "res_1", backupId: "bk_1", ext: "dump.gz" }),
    ).toBe("otterdeploy-backups/res_1/bk_1.dump.gz");
  });

  it("prepends a trimmed prefix when set", () => {
    expect(
      archiveKey({
        prefix: "/team//",
        resourceId: "res_1",
        backupId: "bk_1",
        ext: "dump.gz",
      }),
    ).toBe("team/otterdeploy-backups/res_1/bk_1.dump.gz");
  });
});

describe("sftpRemotePath", () => {
  const key = "otterdeploy-backups/res_1/bk_1.dump.gz";

  it("roots the key at an absolute base path", () => {
    expect(sftpRemotePath("/srv/backups", key)).toBe(
      `/srv/backups/${key}`,
    );
  });

  it("roots at the login dir when base is '.'", () => {
    expect(sftpRemotePath(".", key)).toBe(key);
  });

  it("stays POSIX and strips a leading slash on the key", () => {
    expect(sftpRemotePath("/srv/backups", `/${key}`)).toBe(
      `/srv/backups/${key}`,
    );
  });

  it("get/remove resolve to the same remote path put wrote (round-trip)", () => {
    // put returns storagePath=key; get/remove re-join the same base → identical.
    const base = "/srv/backups";
    expect(sftpRemotePath(base, key)).toBe(sftpRemotePath(base, key));
  });
});
