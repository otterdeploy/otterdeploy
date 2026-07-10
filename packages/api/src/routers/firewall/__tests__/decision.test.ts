import { describe, expect, test } from "vite-plus/test";

import { interpretCscli } from "../decision";

describe("interpretCscli", () => {
  test("null output ⇒ agent-down error", () => {
    const r = interpretCscli(null, "Block failed");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/isn't running/i);
  });

  test("success message ⇒ ok", () => {
    expect(
      interpretCscli("Decision successfully added: IP 1.2.3.4 for 720h", "Block failed"),
    ).toEqual({ ok: true });
  });

  test("delete count message ⇒ ok (not an error)", () => {
    expect(interpretCscli("1 decision(s) deleted", "Unblock failed")).toEqual({ ok: true });
    expect(interpretCscli("0 decision(s) deleted", "Unblock failed")).toEqual({ ok: true });
  });

  test("cscli error output ⇒ failure with the last line as the message", () => {
    const r = interpretCscli("some noise\nError: unable to create decision", "Block failed");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Error: unable to create decision");
  });

  test("empty/whitespace output ⇒ ok (nothing failed)", () => {
    expect(interpretCscli("", "Block failed")).toEqual({ ok: true });
    expect(interpretCscli("   \n ", "Block failed")).toEqual({ ok: true });
  });
});
