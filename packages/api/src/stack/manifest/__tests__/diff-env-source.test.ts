/**
 * od-y64.8: the manifest prunes what the MANIFEST wrote.
 *
 * A key set with `otterdeploy env set` is undeclared by construction — that is
 * what imperative means — so the delete side of the env diff staged
 * "delete env X" for every one of them, and a deploy wiped operator secrets
 * silently. `service_env_var.source` is what lets the two be told apart.
 *
 * The asymmetry is the design, and it is pinned below: an `unknown` row (every
 * row written before the column existed) is treated as the OPERATOR's. Getting
 * that backwards leaves a stale key until the next apply restamps it; getting
 * it the other way destroys a secret.
 */
import { describe, expect, it } from "vite-plus/test";

import { diffEnv } from "../diff-helpers";

const deletions = (changes: ReturnType<typeof diffEnv>) =>
  changes.filter((c) => c.action === "delete").map((c) => c.key);

describe("diffEnv delete side, with provenance", () => {
  it("prunes a key the manifest itself wrote and no longer declares", () => {
    const changes = diffEnv({}, { OLD: "v" }, undefined, { OLD: "manifest" });
    expect(deletions(changes)).toEqual(["OLD"]);
  });

  it("leaves an `env set` key alone", () => {
    // The reported bug: this used to come back as a delete and wipe the secret.
    const changes = diffEnv({}, { API_TOKEN: "s3cret" }, undefined, { API_TOKEN: "cli" });
    expect(deletions(changes)).toEqual([]);
  });

  it("leaves a Variables-tab key alone", () => {
    const changes = diffEnv({}, { TUNED: "v" }, undefined, { TUNED: "ui" });
    expect(deletions(changes)).toEqual([]);
  });

  it("treats a row of unknown provenance as the operator's", () => {
    // Every row that predates the column. Erring the other way costs a secret.
    const changes = diffEnv({}, { LEGACY: "v" }, undefined, { LEGACY: "unknown" });
    expect(deletions(changes)).toEqual([]);
  });

  it("sorts a mixed bag correctly in one pass", () => {
    const changes = diffEnv({}, { FROM_FILE: "a", FROM_CLI: "b", LEGACY: "c" }, undefined, {
      FROM_FILE: "manifest",
      FROM_CLI: "cli",
      LEGACY: "unknown",
    });
    expect(deletions(changes)).toEqual(["FROM_FILE"]);
  });

  it("keeps the old behaviour when no provenance is supplied", () => {
    // Database extraEnv is a jsonb blob with no per-key owner, so it passes
    // nothing and must keep pruning exactly as before.
    const changes = diffEnv({}, { GONE: "v" });
    expect(deletions(changes)).toEqual(["GONE"]);
  });

  it("still creates and updates regardless of provenance", () => {
    const changes = diffEnv({ A: "new", B: "same" }, { B: "same" }, undefined, { B: "cli" });
    expect(changes.filter((c) => c.action === "create").map((c) => c.key)).toEqual(["A"]);
    expect(changes.filter((c) => c.action === "update")).toEqual([]);
  });
});
