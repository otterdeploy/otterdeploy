/**
 * Pure mapping layer for the rustic engine: destination → repository URL +
 * OpenDAL options, and the repo-id derivation that scopes each repo. No daemon
 * or network — the invocation side (RusticCli) is smoke-tested against a real
 * binary separately.
 */
import { describe, expect, it } from "vite-plus/test";

import type { ResolvedDestination } from "../backends";
import type { ExecutionContext } from "../db";

import { deriveRepoId, repoScope, toRusticRepo } from "../backends";

describe("toRusticRepo — local", () => {
  it("roots the repo at <path>/<repoId>", () => {
    const dest: ResolvedDestination = {
      type: "local",
      config: { path: "/srv/backups" },
      secret: {},
    };
    expect(toRusticRepo(dest, "otterdeploy-backups/res_1")).toEqual({
      repoId: "otterdeploy-backups/res_1",
      repository: "/srv/backups/otterdeploy-backups/res_1",
      options: {},
    });
  });

  it("trims a trailing slash on the path", () => {
    const dest: ResolvedDestination = {
      type: "local",
      config: { path: "/srv/backups/" },
      secret: {},
    };
    expect(toRusticRepo(dest, "r").repository).toBe("/srv/backups/r");
  });

  it("throws when path is missing", () => {
    const dest: ResolvedDestination = { type: "local", config: {}, secret: {} };
    expect(() => toRusticRepo(dest, "r")).toThrow(/missing `path`/);
  });
});

describe("toRusticRepo — s3", () => {
  const base: ResolvedDestination = {
    type: "s3",
    config: { bucket: "my-bucket" },
    secret: { accessKeyId: "AKIA", secretAccessKey: "shhh" },
  };

  it("maps to opendal:s3 with root=repoId and creds in options", () => {
    expect(toRusticRepo(base, "otterdeploy-backups/res_1")).toEqual({
      repoId: "otterdeploy-backups/res_1",
      repository: "opendal:s3",
      options: {
        bucket: "my-bucket",
        root: "otterdeploy-backups/res_1",
        access_key_id: "AKIA",
        secret_access_key: "shhh",
      },
    });
  });

  it("includes region and endpoint only when set (MinIO/R2)", () => {
    const dest: ResolvedDestination = {
      type: "s3",
      config: { bucket: "b", region: "eu-central-1", endpoint: "https://r2.example.com" },
      secret: { accessKeyId: "k", secretAccessKey: "s" },
    };
    const { options } = toRusticRepo(dest, "r");
    expect(options.region).toBe("eu-central-1");
    expect(options.endpoint).toBe("https://r2.example.com");
  });

  it("throws on a missing bucket", () => {
    const dest: ResolvedDestination = { ...base, config: {} };
    expect(() => toRusticRepo(dest, "r")).toThrow(/missing `bucket`/);
  });

  it("throws on missing credentials", () => {
    const dest: ResolvedDestination = { ...base, secret: {} };
    expect(() => toRusticRepo(dest, "r")).toThrow(/missing credentials/);
  });
});

describe("toRusticRepo — sftp", () => {
  it("maps a key-auth destination to opendal:sftp", () => {
    const dest: ResolvedDestination = {
      type: "sftp",
      config: { host: "backup.example.com", port: 2222 },
      secret: { username: "otter", privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----" },
    };
    expect(toRusticRepo(dest, "otterdeploy-backups/res_1")).toEqual({
      repoId: "otterdeploy-backups/res_1",
      repository: "opendal:sftp",
      options: {
        user: "otter",
        endpoint: "ssh://backup.example.com:2222",
        root: "otterdeploy-backups/res_1",
      },
    });
  });

  it("defaults the port to 22", () => {
    const dest: ResolvedDestination = {
      type: "sftp",
      config: { host: "h" },
      secret: { username: "u", privateKey: "key" },
    };
    expect(toRusticRepo(dest, "r").options.endpoint).toBe("ssh://h:22");
  });

  it("rejects password-only auth (key-auth only)", () => {
    const dest: ResolvedDestination = {
      type: "sftp",
      config: { host: "h" },
      secret: { username: "u", password: "pw" },
    };
    expect(() => toRusticRepo(dest, "r")).toThrow(/password auth/i);
  });

  it("rejects a destination with no SSH key at all", () => {
    const dest: ResolvedDestination = {
      type: "sftp",
      config: { host: "h" },
      secret: { username: "u" },
    };
    expect(() => toRusticRepo(dest, "r")).toThrow(/key-auth only/i);
  });

  it("throws on a missing host", () => {
    const dest: ResolvedDestination = {
      type: "sftp",
      config: {},
      secret: { username: "u", privateKey: "k" },
    };
    expect(() => toRusticRepo(dest, "r")).toThrow(/missing `host`/);
  });
});

// Minimal ExecutionContext fixtures — repoScope/deriveRepoId only read kind,
// the source id, and destination.config.prefix.
function dbCtx(prefix?: string): ExecutionContext {
  return {
    kind: "database",
    resourceId: "res_1",
    destination: { config: prefix === undefined ? {} : { prefix } },
  } as unknown as ExecutionContext;
}
function volCtx(prefix?: string): ExecutionContext {
  return {
    kind: "volume",
    volumeName: "pgdata",
    destination: { config: prefix === undefined ? {} : { prefix } },
  } as unknown as ExecutionContext;
}

describe("repoScope", () => {
  it("scopes a database run by resourceId", () => {
    expect(repoScope(dbCtx())).toBe("res_1");
  });
  it("scopes a volume run by volume-<name>", () => {
    expect(repoScope(volCtx())).toBe("volume-pgdata");
  });
});

describe("deriveRepoId", () => {
  it("roots under otterdeploy-backups/<scope>", () => {
    expect(deriveRepoId(dbCtx())).toBe("otterdeploy-backups/res_1");
    expect(deriveRepoId(volCtx())).toBe("otterdeploy-backups/volume-pgdata");
  });

  it("prepends a trimmed prefix when the destination sets one", () => {
    expect(deriveRepoId(dbCtx("/team//"))).toBe("team/otterdeploy-backups/res_1");
  });
});
