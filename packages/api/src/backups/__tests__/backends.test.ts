/**
 * Pure mapping layer for the rustic engine: destination → repository URL +
 * OpenDAL options, and the repo-key derivation that scopes each repo. No daemon
 * or network: the invocation side (RusticCli) is smoke-tested against a real
 * binary separately.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { orgBackupRepoRoot } from "@otterdeploy/shared/paths";
import { describe, expect, it } from "vite-plus/test";

import type { RepoIdSource, RepoKey, ResolvedDestination } from "../backends";

import { deriveRepoKey, repoScope, toRusticRepo } from "../backends";
import { deriveRepoPassword } from "../rustic";

// External destinations use the repo id as its own password domain.
const key = (repoId: string): RepoKey => ({ repoId, passwordDomain: repoId });

describe("toRusticRepo: local", () => {
  it("roots the repo at <path>/<repoId>", () => {
    const dest: ResolvedDestination = {
      type: "local",
      config: { path: "/srv/backups" },
      secret: {},
    };
    expect(toRusticRepo(dest, key("otterdeploy-backups/res_1"))).toEqual({
      repoId: "otterdeploy-backups/res_1",
      passwordDomain: "otterdeploy-backups/res_1",
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
    expect(toRusticRepo(dest, key("r")).repository).toBe("/srv/backups/r");
  });

  it("throws when path is missing", () => {
    const dest: ResolvedDestination = { type: "local", config: {}, secret: {} };
    expect(() => toRusticRepo(dest, key("r"))).toThrow(/missing `path`/);
  });
});

describe("toRusticRepo: s3", () => {
  const base: ResolvedDestination = {
    type: "s3",
    config: { bucket: "my-bucket" },
    secret: { accessKeyId: "AKIA", secretAccessKey: "shhh" },
  };

  it("maps to opendal:s3 with root=repoId and creds in options", () => {
    expect(toRusticRepo(base, key("otterdeploy-backups/res_1"))).toEqual({
      repoId: "otterdeploy-backups/res_1",
      passwordDomain: "otterdeploy-backups/res_1",
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
    const { options } = toRusticRepo(dest, key("r"));
    expect(options.region).toBe("eu-central-1");
    expect(options.endpoint).toBe("https://r2.example.com");
  });

  it("throws on a missing bucket", () => {
    const dest: ResolvedDestination = { ...base, config: {} };
    expect(() => toRusticRepo(dest, key("r"))).toThrow(/missing `bucket`/);
  });

  it("throws on missing credentials", () => {
    const dest: ResolvedDestination = { ...base, secret: {} };
    expect(() => toRusticRepo(dest, key("r"))).toThrow(/missing credentials/);
  });
});

describe("toRusticRepo: sftp", () => {
  it("maps a key-auth destination to opendal:sftp", () => {
    const dest: ResolvedDestination = {
      type: "sftp",
      config: { host: "backup.example.com", port: 2222 },
      secret: { username: "otter", privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----" },
    };
    expect(toRusticRepo(dest, key("otterdeploy-backups/res_1"))).toEqual({
      repoId: "otterdeploy-backups/res_1",
      passwordDomain: "otterdeploy-backups/res_1",
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
    expect(toRusticRepo(dest, key("r")).options.endpoint).toBe("ssh://h:22");
  });

  it("rejects password-only auth (key-auth only)", () => {
    const dest: ResolvedDestination = {
      type: "sftp",
      config: { host: "h" },
      secret: { username: "u", password: "pw" },
    };
    expect(() => toRusticRepo(dest, key("r"))).toThrow(/password auth/i);
  });

  it("rejects a destination with no SSH key at all", () => {
    const dest: ResolvedDestination = {
      type: "sftp",
      config: { host: "h" },
      secret: { username: "u" },
    };
    expect(() => toRusticRepo(dest, key("r"))).toThrow(/key-auth only/i);
  });

  it("throws on a missing host", () => {
    const dest: ResolvedDestination = {
      type: "sftp",
      config: {},
      secret: { username: "u", privateKey: "k" },
    };
    expect(() => toRusticRepo(dest, key("r"))).toThrow(/missing `host`/);
  });
});

// Minimal fixtures: repoScope/deriveRepoKey read only the source discriminant,
// the org, and the destination's `managed` flag + `config.prefix` (RepoIdSource).
interface CtxOpts {
  prefix?: string;
  managed?: boolean;
  org?: string;
}
function dbCtx(opts: CtxOpts = {}): RepoIdSource {
  return {
    kind: "database",
    resourceId: "res_1",
    organizationId: opts.org ?? "org_test",
    destination: {
      config: opts.prefix === undefined ? {} : { prefix: opts.prefix },
      managed: opts.managed ?? false,
    },
  };
}
function volCtx(opts: CtxOpts = {}): RepoIdSource {
  return {
    kind: "volume",
    volumeName: "pgdata",
    organizationId: opts.org ?? "org_test",
    destination: {
      config: opts.prefix === undefined ? {} : { prefix: opts.prefix },
      managed: opts.managed ?? false,
    },
  };
}

describe("repoScope", () => {
  it("scopes a database run by resourceId", () => {
    expect(repoScope(dbCtx())).toBe("res_1");
  });
  it("scopes a volume run by volume-<name>", () => {
    expect(repoScope(volCtx())).toBe("volume-pgdata");
  });
});

describe("deriveRepoKey: external destinations", () => {
  it("roots under otterdeploy-backups/<scope>, password domain = repo id", () => {
    expect(deriveRepoKey(dbCtx())).toEqual(key("otterdeploy-backups/res_1"));
    expect(deriveRepoKey(volCtx())).toEqual(key("otterdeploy-backups/volume-pgdata"));
  });

  it("prepends a trimmed prefix when the destination sets one", () => {
    expect(deriveRepoKey(dbCtx({ prefix: "/team//" }))).toEqual(
      key("team/otterdeploy-backups/res_1"),
    );
  });
});

describe("deriveRepoKey: managed local destination", () => {
  it("repo id is the bare scope; password domain is org-qualified", () => {
    expect(deriveRepoKey(dbCtx({ managed: true, org: "org_a" }))).toEqual({
      repoId: "res_1",
      passwordDomain: "org_a/res_1",
    });
    expect(deriveRepoKey(volCtx({ managed: true, org: "org_a" }))).toEqual({
      repoId: "volume-pgdata",
      passwordDomain: "org_a/volume-pgdata",
    });
  });

  it("ignores a prefix key: managed config is platform-owned and has none", () => {
    expect(deriveRepoKey(dbCtx({ managed: true, prefix: "stale" })).repoId).toBe("res_1");
  });

  it("two orgs, same volume scope: identical on-disk repo id, different passwords", () => {
    // The path already separates the orgs (each managed root is
    // orgs/<org>/backups/), so the repo id: and with it the on-disk layout -
    // must not change; only the derived password may.
    const a = deriveRepoKey(volCtx({ managed: true, org: "org_a" }));
    const b = deriveRepoKey(volCtx({ managed: true, org: "org_b" }));
    expect(a.repoId).toBe(b.repoId);
    expect(a.passwordDomain).not.toBe(b.passwordDomain);
    expect(deriveRepoPassword("auth-secret", a.passwordDomain)).not.toBe(
      deriveRepoPassword("auth-secret", b.passwordDomain),
    );
  });

  it("lands the repo at orgs/<org>/backups/<scope> with the managed config path", () => {
    const orgId = idSchema.organization.parse("org_a");
    const dest: ResolvedDestination = {
      type: "local",
      config: { path: orgBackupRepoRoot(orgId) },
      secret: {},
    };
    const repoKey = deriveRepoKey(dbCtx({ managed: true, org: orgId }));
    expect(toRusticRepo(dest, repoKey).repository).toBe(`${orgBackupRepoRoot(orgId)}/res_1`);
  });
});
