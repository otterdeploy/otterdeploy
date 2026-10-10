/**
 * `otd deploy` with a pending delete. Answering no at
 * "N resources will be deleted. Continue?" (or Ctrl-C, or no terminal) said
 * "Nothing was applied" while the local manifest, deletions included, had
 * already been SAVED as the server's: the web pending-changes bar showed the
 * deletions staged, one "Apply all" away from destroying the resources. A
 * declined run must leave the saved manifest untouched; an agreed one saves
 * and applies.
 */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const calls: string[] = [];
const answer = { proceed: false };

const project = { id: "prj_deployrun", slug: "deployrun", name: "deployrun" };
const localManifest = { project: "deployrun", services: {}, databases: {}, composes: {} };

const fakeClient = {
  project: {
    getBySlug: async () => project,
    manifest: {
      get: async () => ({ version: 4, manifest: localManifest }),
      diff: async (input: { manifest?: unknown }) => {
        // The preview must be of the local file itself, not of what is saved.
        calls.push(input.manifest === undefined ? "diff(saved)" : "diff(local)");
        return { resolved: null, changes: [{ kind: "delete", resource: "service", name: "web" }] };
      },
      save: async () => {
        calls.push("save");
        return { version: 5 };
      },
      applyChange: async () => {
        calls.push("applyChange");
        return { appliedCount: 1, skipped: [], rollouts: [], version: 5 };
      },
    },
  },
};

vi.mock("../auth-flow", () => ({
  ensureAuthenticated: async () => ({ url: "http://127.0.0.1:1", token: "otter_test" }),
}));
vi.mock("../client", () => ({ createCliClient: () => fakeClient }));
vi.mock("../config-file", () => ({
  configPath: () => "/nonexistent/otterdeploy.json",
  loadConfig: async () => localManifest,
}));
vi.mock("./ui", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return {
    ...real,
    confirm: async () => answer.proceed,
    // The real abort exits the process; here it ends the run where it would.
    abort: (message: string) => {
      calls.push(`abort: ${message}`);
      throw new Error(message);
    },
    // Keep the output out of the test log.
    note: () => {},
    ok: () => {},
    out: () => {},
    section: () => {},
    detail: () => {},
  };
});
vi.mock("./diff-printer", () => ({
  countByKind: (changes: Array<{ kind: string }>) => {
    const counts: Record<string, number> = {};
    for (const c of changes) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    return counts;
  },
  printChangeSummary: () => {},
  printDiff: () => {},
}));

import { runDeploy } from "./deploy-run";

beforeEach(() => {
  calls.length = 0;
});

describe("otd deploy with a pending delete", () => {
  it("declining the confirmation saves nothing: the deletions are not staged on the server", async () => {
    answer.proceed = false;
    await expect(runDeploy({})).rejects.toThrow(/Aborted/);
    expect(calls).not.toContain("save");
    expect(calls).not.toContain("applyChange");
    expect(calls[0]).toBe("diff(local)");
  });

  it("agreeing saves the manifest, then applies it", async () => {
    answer.proceed = true;
    await runDeploy({});
    expect(calls).toEqual(["diff(local)", "save", "applyChange"]);
  });

  it("--yes skips the prompt and still saves before applying", async () => {
    answer.proceed = false;
    await runDeploy({ yes: true });
    expect(calls).toEqual(["diff(local)", "save", "applyChange"]);
  });
});
