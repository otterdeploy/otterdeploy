import { describe, expect, it } from "vite-plus/test";

import { isAuthorizedCommenter, parseCommentCommand } from "../comment-command";

/**
 * These guard an authorization boundary: on a public repository, anyone can
 * comment. A parser that is too eager, or an association check that is too
 * generous, turns a comment box into a request to provision compute and clone a
 * database on someone else's machine.
 */

describe("parseCommentCommand", () => {
  it("recognises the command on its own line", () => {
    expect(parseCommentCommand("@otterdeploy preview")).toBe("preview");
    expect(parseCommentCommand("@otterdeploy   preview")).toBe("preview");
    expect(parseCommentCommand("@OtterDeploy Preview")).toBe("preview");
  });

  it("finds it among other lines", () => {
    expect(parseCommentCommand("looks good to me\n\n@otterdeploy preview")).toBe("preview");
  });

  it("does NOT fire when the mention is buried in prose", () => {
    // The single most important case: discussing the command must not run it.
    expect(parseCommentCommand("we should not run @otterdeploy preview here")).toBeNull();
    expect(parseCommentCommand("maybe @otterdeploy preview would help?")).toBeNull();
  });

  it("tolerates GitHub's reply quoting", () => {
    // Quoting and then issuing the command is still a deliberate act.
    expect(parseCommentCommand("> earlier text\n@otterdeploy preview")).toBe("preview");
    expect(parseCommentCommand("  @otterdeploy preview")).toBe("preview");
  });

  it("ignores unknown commands rather than guessing", () => {
    expect(parseCommentCommand("@otterdeploy deploy")).toBeNull();
    expect(parseCommentCommand("@otterdeploy destroy-everything")).toBeNull();
    expect(parseCommentCommand("@otterdeploy")).toBeNull();
  });

  it("ignores a mention of a different bot with a similar name", () => {
    expect(parseCommentCommand("@otterdeploy-staging preview")).toBeNull();
    expect(parseCommentCommand("@nototterdeploy preview")).toBeNull();
  });

  it("handles empty and missing bodies", () => {
    expect(parseCommentCommand("")).toBeNull();
    expect(parseCommentCommand(null)).toBeNull();
    expect(parseCommentCommand(undefined)).toBeNull();
  });
});

describe("isAuthorizedCommenter", () => {
  it("allows write access and above", () => {
    for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) {
      expect(isAuthorizedCommenter(association)).toBe(true);
    }
  });

  it("refuses everyone else, including past contributors", () => {
    // CONTRIBUTOR means "has had a PR merged", not "has write access" — a low
    // bar for spending someone else's disk and CPU.
    for (const association of [
      "CONTRIBUTOR",
      "FIRST_TIME_CONTRIBUTOR",
      "FIRST_TIMER",
      "NONE",
      "MANNEQUIN",
    ]) {
      expect(isAuthorizedCommenter(association)).toBe(false);
    }
  });

  it("fails closed on a missing or unrecognised association", () => {
    expect(isAuthorizedCommenter(null)).toBe(false);
    expect(isAuthorizedCommenter(undefined)).toBe(false);
    expect(isAuthorizedCommenter("")).toBe(false);
    expect(isAuthorizedCommenter("SOMETHING_NEW_FROM_GITHUB")).toBe(false);
  });
});
