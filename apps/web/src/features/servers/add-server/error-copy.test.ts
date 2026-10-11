import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vite-plus/test";

import { stepUpErrorText } from "./command-flow";
import { sshFailureTitle } from "./ssh-run";
import { parsePort, provisionErrorText } from "./use-ssh-form";

describe("stepUpErrorText", () => {
  const wrong = new ORPCError("INVALID_STEP_UP", { status: 403 });

  it("says the password was wrong in plain words", () => {
    expect(stepUpErrorText(wrong, false)).toBe("That password isn't right. Try again.");
  });

  it("says the code was wrong for an account with an authenticator", () => {
    expect(stepUpErrorText(wrong, true)).toBe("That code isn't right. Try again.");
  });

  it("keeps the server's own message for anything else", () => {
    expect(stepUpErrorText(new Error("Enter the code we emailed you."), false)).toBe(
      "Enter the code we emailed you.",
    );
  });
});

describe("provisionErrorText", () => {
  it("names a duplicate address instead of a bare conflict", () => {
    expect(provisionErrorText(new ORPCError("CONFLICT", { status: 409 }))).toContain(
      "already been added",
    );
  });
});

describe("parsePort", () => {
  it("accepts a real port and rejects anything else", () => {
    expect(parsePort("22")).toBe(22);
    expect(parsePort(" 2222 ")).toBe(2222);
    expect(parsePort("0")).toBeNull();
    expect(parsePort("70000")).toBeNull();
    expect(parsePort("ssh")).toBeNull();
  });
});

describe("sshFailureTitle", () => {
  it("names the step the install stopped on", () => {
    expect(sshFailureTitle("docker", "203.0.113.24")).toBe("Docker didn't install on 203.0.113.24");
    expect(sshFailureTitle("ssh", "h")).toBe("Couldn't connect to h over SSH");
    expect(sshFailureTitle(null, "h")).toBe("The install stopped on h");
  });
});
