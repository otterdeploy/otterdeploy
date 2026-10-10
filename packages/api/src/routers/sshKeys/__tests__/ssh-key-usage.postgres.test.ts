/**
 * An SSH key a server signs in with is in use, and the key page's actions
 * have to respect that.
 *
 * - `usedBy` is derived from `server.ssh_key_id`, so a key a worker was
 *   provisioned with no longer reads "Not in use".
 * - Delete refuses while any server still uses the key, naming the servers,
 *   instead of nulling their `ssh_key_id` and cutting the control plane off.
 * - Rotate on an in-use key pushes the new public key to every server over
 *   the current key, checks the new key signs in, and only then swaps the
 *   stored key and removes the old public key. If any server is unreachable
 *   or fails, nothing is swapped and every server is left accepting the old
 *   key (the new public key is removed again where it was added).
 *
 * Real Postgres and the real handlers. The SSH transport is replaced at its
 * boundary (`SshSession`) by a stand-in that keeps each "host" as a home
 * directory on disk: a connection is accepted only for a private key whose
 * public half is in that home's `~/.ssh/authorized_keys`, and remote scripts
 * run under bash with HOME pointed at it, so the real authorized_keys edits
 * are what get exercised.
 */
import type { OrganizationId, ServerId, SshKeyId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { server } from "@otterdeploy/db/schema/server";
import { eq } from "drizzle-orm";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { seedOrganization, uniq } from "../../../__tests__/postgres-seed";
import { insertProvisioningServer } from "../../server/queries";
import { deleteSshKey, generateSshKey, importSshKey, listSshKeys } from "../handlers";
import { getSshKeyInOrg } from "../queries";
import { rotateSshKey } from "../rotate";

interface FakeHost {
  home: string;
  reachable: boolean;
  /** When set, sshd only ever accepts these key blobs, whatever the file says:
   *  a host whose authorized_keys edits don't take effect. */
  frozenLogins: Set<string> | null;
}

const { hosts, emitted } = vi.hoisted(() => ({
  hosts: new Map<string, FakeHost>(),
  emitted: new Array<{ eventId: string; data?: unknown }>(),
}));

/** The base64 blob of an OpenSSH public-key line (its second field). */
function blobOf(publicKeyLine: string): string {
  return publicKeyLine.trim().split(/\s+/)[1] ?? "";
}

async function authorizedBlobs(home: string): Promise<Set<string>> {
  const text = await readFile(join(home, ".ssh", "authorized_keys"), "utf8").catch(() => "");
  const blobs = new Set<string>();
  for (const line of text.split("\n")) {
    for (const field of line.trim().split(/\s+/)) blobs.add(field);
  }
  return blobs;
}

async function publicBlobOfPrivate(privateKey: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fake-ssh-priv-"));
  try {
    const path = join(dir, "key");
    await writeFile(path, privateKey, { mode: 0o600 });
    const proc = Bun.spawn(["ssh-keygen", "-y", "-f", path], { stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) throw new Error("fake ssh: unreadable private key");
    return blobOf(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

vi.mock("../../server/ssh-exec", () => {
  class FakeSshSession {
    private constructor(private readonly home: string) {}

    static async connect(target: { host: string; privateKey?: string }) {
      const host = hosts.get(target.host);
      if (!host || !host.reachable) {
        throw new Error("SSH connection timed out. Is the host reachable and is port open?");
      }
      const blob = await publicBlobOfPrivate(target.privateKey ?? "");
      const accepted = host.frozenLogins ?? (await authorizedBlobs(host.home));
      if (!accepted.has(blob)) {
        throw new Error("SSH authentication failed. Check the key is installed.");
      }
      return new FakeSshSession(host.home);
    }

    async runScript(script: string) {
      const proc = Bun.spawn(["bash", "-c", script], {
        env: { HOME: this.home, PATH: Bun.env.PATH ?? "/usr/bin:/bin" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { exitCode, output: stdout + stderr };
    }

    dispose() {}
  }
  return { SshSession: FakeSshSession };
});

vi.mock("../../../notifications/emit", () => ({
  emitPlatformEvent: async (event: { eventId: string; data?: unknown }) => {
    emitted.push(event);
  },
}));

const UNRELATED_LINE =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOperatorLaptopKeyStaysPut0000000000000 me@laptop";

let organizationId: OrganizationId;
const homes: string[] = [];

beforeEach(async () => {
  organizationId = await seedOrganization("sshkeys");
  hosts.clear();
  emitted.length = 0;
});

afterAll(async () => {
  await Promise.all(homes.map((h) => rm(h, { recursive: true, force: true })));
});

async function newKey(): Promise<{ id: SshKeyId; publicKey: string; fingerprint: string }> {
  const key = await generateSshKey({ organizationId, name: `key-${uniq()}`, type: "ed25519" });
  if (key.isErr()) throw new Error(`seed ssh key: ${key.error.message}`);
  return key.value;
}

/** A server row using `sshKeyId`, plus a fake host whose authorized_keys holds
 *  an unrelated operator key and `authorized`. */
async function newServer(
  sshKeyId: SshKeyId,
  authorized: string,
  opts: { reachable?: boolean; frozen?: boolean } = {},
): Promise<{ id: ServerId; name: string; host: string; home: string }> {
  const name = `node-${uniq()}`;
  const host = `${name}.internal`;
  const row = await insertProvisioningServer({
    organizationId,
    name,
    host,
    role: "worker",
    sshKeyId,
    sshUser: "root",
    sshPort: 22,
  });
  if (!row) throw new Error("server insert returned no row");
  const home = await mkdtemp(join(tmpdir(), "fake-ssh-home-"));
  homes.push(home);
  await mkdir(join(home, ".ssh"), { mode: 0o700 });
  await writeFile(join(home, ".ssh", "authorized_keys"), `${UNRELATED_LINE}\n${authorized}\n`, {
    mode: 0o600,
  });
  hosts.set(host, {
    home,
    reachable: opts.reachable ?? true,
    frozenLogins: opts.frozen ? new Set([blobOf(authorized)]) : null,
  });
  return { id: row.id, name, host, home };
}

const authorizedKeys = (home: string) => readFile(join(home, ".ssh", "authorized_keys"), "utf8");

describe("usedBy", () => {
  it("lists the servers that sign in with a key, and nothing for an unused key", async () => {
    const used = await newKey();
    const unused = await newKey();
    const a = await newServer(used.id, used.publicKey);
    const b = await newServer(used.id, used.publicKey);

    const keys = await listSshKeys({ organizationId });
    const usedRow = keys.find((k) => k.id === used.id);
    const unusedRow = keys.find((k) => k.id === unused.id);

    expect(usedRow?.usedBy).toHaveLength(2);
    expect(usedRow?.usedBy).toEqual(
      expect.arrayContaining([
        { kind: "server", serverId: a.id, name: a.name, role: "worker" },
        { kind: "server", serverId: b.id, name: b.name, role: "worker" },
      ]),
    );
    expect(unusedRow?.usedBy).toEqual([]);
  });

  it("never reports another organization's servers", async () => {
    const used = await newKey();
    await newServer(used.id, used.publicKey);
    const otherOrg = await seedOrganization("sshkeys-other");

    const keys = await listSshKeys({ organizationId: otherOrg });
    expect(keys).toEqual([]);
  });
});

describe("delete", () => {
  it("refuses while a server uses the key, naming the servers, and changes nothing", async () => {
    const key = await newKey();
    const a = await newServer(key.id, key.publicKey);

    const result = await deleteSshKey({ id: key.id, organizationId });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("SshKeyInUseError");
    if (result.error._tag !== "SshKeyInUseError") return;
    expect(result.error.servers).toEqual([{ serverId: a.id, name: a.name }]);
    expect(await getSshKeyInOrg({ id: key.id, organizationId })).toBeDefined();
    const [row] = await db.select().from(server).where(eq(server.id, a.id));
    expect(row?.sshKeyId).toBe(key.id);
  });

  it("deletes a key no server uses", async () => {
    const key = await newKey();
    const result = await deleteSshKey({ id: key.id, organizationId });
    expect(result.isOk()).toBe(true);
    expect(await getSshKeyInOrg({ id: key.id, organizationId })).toBeUndefined();
  });
});

describe("rotate", () => {
  it("pushes the new key over the old one, checks it, swaps, then removes the old key", async () => {
    const key = await newKey();
    const a = await newServer(key.id, key.publicKey);
    const b = await newServer(key.id, key.publicKey);

    const result = await rotateSshKey({ id: key.id, organizationId });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const rotated = result.value;
    expect(rotated.key.fingerprint).not.toBe(key.fingerprint);
    expect(rotated.servers).toEqual(
      expect.arrayContaining([
        { serverId: a.id, name: a.name, outcome: "reauthorized", step: null, error: null },
        { serverId: b.id, name: b.name, outcome: "reauthorized", step: null, error: null },
      ]),
    );

    const stored = await getSshKeyInOrg({ id: key.id, organizationId });
    expect(stored?.fingerprint).toBe(rotated.key.fingerprint);
    for (const home of [a.home, b.home]) {
      const text = await authorizedKeys(home);
      expect(text).toContain(blobOf(rotated.key.publicKey));
      expect(text).not.toContain(blobOf(key.publicKey));
      expect(text).toContain(UNRELATED_LINE);
    }
    expect(emitted.map((e) => e.eventId)).toEqual(["ssh.rotated"]);
  });

  it("aborts before the swap when a server is unreachable, and rolls the others back", async () => {
    const key = await newKey();
    const a = await newServer(key.id, key.publicKey);
    const down = await newServer(key.id, key.publicKey, { reachable: false });
    const before = await authorizedKeys(a.home);

    const result = await rotateSshKey({ id: key.id, organizationId });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error._tag).toBe("SshKeyRotateFailedError");
    if (result.error._tag !== "SshKeyRotateFailedError") return;
    const byId = new Map(result.error.servers.map((s) => [s.serverId, s]));
    expect(byId.get(a.id)?.outcome).toBe("rolled_back");
    expect(byId.get(down.id)?.outcome).toBe("failed");
    expect(byId.get(down.id)?.step).toBe("connect");
    expect(byId.get(down.id)?.error).toMatch(/timed out/);

    const stored = await getSshKeyInOrg({ id: key.id, organizationId });
    expect(stored?.fingerprint).toBe(key.fingerprint);
    expect(stored?.publicKey).toBe(key.publicKey);
    expect(await authorizedKeys(a.home)).toBe(before);
    expect(emitted).toEqual([]);
  });

  it("aborts when the new key can't sign in, removing it again everywhere it was added", async () => {
    const key = await newKey();
    const a = await newServer(key.id, key.publicKey);
    const stuck = await newServer(key.id, key.publicKey, { frozen: true });
    const beforeA = await authorizedKeys(a.home);
    const beforeStuck = await authorizedKeys(stuck.home);

    const result = await rotateSshKey({ id: key.id, organizationId });

    expect(result.isErr()).toBe(true);
    if (result.isOk() || result.error._tag !== "SshKeyRotateFailedError") return;
    const byId = new Map(result.error.servers.map((s) => [s.serverId, s]));
    expect(byId.get(stuck.id)?.outcome).toBe("failed");
    expect(byId.get(stuck.id)?.step).toBe("verify");
    expect(byId.get(a.id)?.outcome).toBe("rolled_back");

    expect((await getSshKeyInOrg({ id: key.id, organizationId }))?.fingerprint).toBe(
      key.fingerprint,
    );
    expect(await authorizedKeys(a.home)).toBe(beforeA);
    expect(await authorizedKeys(stuck.home)).toBe(beforeStuck);
    expect(emitted).toEqual([]);
  });

  it("swaps an unused key without touching any server", async () => {
    const key = await newKey();
    const result = await rotateSshKey({ id: key.id, organizationId });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.servers).toEqual([]);
    expect(result.value.key.fingerprint).not.toBe(key.fingerprint);
    expect(emitted.map((e) => e.eventId)).toEqual(["ssh.rotated"]);
  });

  it("keeps imported keys unrotatable", async () => {
    const source = await newKey();
    await deleteSshKey({ id: source.id, organizationId });
    const imported = await importSshKey({
      organizationId,
      name: `imp-${uniq()}`,
      publicKey: source.publicKey,
    });
    if (imported.isErr()) throw new Error(imported.error.message);
    const result = await rotateSshKey({ id: imported.value.id, organizationId });
    expect(result.isErr() && result.error._tag).toBe("SshKeyNotRotatableError");
  });
});
