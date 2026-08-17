import { describe, expect, it } from "vite-plus/test";

import { branchDependentsMessage } from "../branch-dependents";

/**
 * A raw ZFS error about dependent clones is unactionable. Nothing in the UI
 * connects a dataset to someone's open pull request. These pin that the refusal
 * is an instruction instead: which PRs, and which of them will not clear on
 * their own.
 */

describe("branchDependentsMessage", () => {
  it("permits the delete when nothing depends on it", () => {
    expect(branchDependentsMessage([])).toBeNull();
  });

  it("names every pull request holding the database", () => {
    const message = branchDependentsMessage([
      { prNumber: 128, pinned: false },
      { prNumber: 131, pinned: false },
    ]);
    expect(message).toContain("PR 128");
    expect(message).toContain("PR 131");
    expect(message).toContain("2 preview branches depend");
  });

  it("agrees with itself grammatically for a single branch", () => {
    const message = branchDependentsMessage([{ prNumber: 7, pinned: false }]);
    expect(message).toContain("1 preview branch depends");
    expect(message).not.toContain("branches depend");
  });

  it("marks a pinned preview and changes the advice", () => {
    // A pinned preview never reaches auto_teardown_at, so "wait" is wrong.
    // It needs a person. The two cases must not share a resolution.
    const message = branchDependentsMessage([
      { prNumber: 128, pinned: false },
      { prNumber: 140, pinned: true },
    ]);
    expect(message).toContain("PR 140 (pinned)");
    expect(message).toContain("unpin");
    expect(message).not.toContain("wait for the previews");
  });

  it("offers waiting only when every dependent will expire", () => {
    const message = branchDependentsMessage([{ prNumber: 128, pinned: false }]);
    expect(message).toContain("wait for the previews");
    expect(message).not.toContain("unpin");
  });
});
