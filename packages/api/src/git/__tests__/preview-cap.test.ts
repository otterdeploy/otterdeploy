import { describe, expect, it } from "vite-plus/test";

import { previewCapMessage } from "../preview-cap";

/**
 * The DB-backed half of the cap (`checkPreviewCap`) is exercised by the
 * integration suite; what is worth pinning in a unit test is the message,
 * because a cap that refuses without saying why is the failure mode the rule
 * "never a silent cap" exists to prevent.
 */

describe("previewCapMessage", () => {
  it("names the limit and the current count", () => {
    const message = previewCapMessage({ cap: 10, current: 10 });
    expect(message).toContain("10 concurrent previews");
    expect(message).toContain("(10 open)");
  });

  it("says what to actually do about it", () => {
    // "At capacity" with no next step generates a support question rather than
    // an action. Both escape routes have to be in the text.
    const message = previewCapMessage({ cap: 5, current: 5 });
    expect(message.toLowerCase()).toContain("free a slot");
    expect(message).toContain("Settings → Instance");
  });

  it("leads with the outcome, not the explanation", () => {
    // The first line is what shows in a GitHub notification digest.
    const [first] = previewCapMessage({ cap: 3, current: 3 }).split("\n");
    expect(first).toContain("Preview not created");
  });

  it("reports an over-cap count honestly rather than clamping it", () => {
    // Two PRs opened in the same instant can both pass the check-then-act and
    // land at cap+1. The message must not pretend that didn't happen.
    const message = previewCapMessage({ cap: 10, current: 11 });
    expect(message).toContain("(11 open)");
  });
});
