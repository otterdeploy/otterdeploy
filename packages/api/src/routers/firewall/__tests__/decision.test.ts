import { describe, expect, test } from "vite-plus/test";

import { interpretCscli, interpretUnblock } from "../decision";

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

describe("interpretUnblock", () => {
  test("a removed ban ⇒ ok", () => {
    expect(interpretUnblock("1 decision(s) deleted", "1.2.3.4")).toEqual({ ok: true });
    expect(interpretUnblock("3 decision(s) deleted", "1.2.3.4")).toEqual({ ok: true });
  });

  test("nothing removed ⇒ failure that names the address", () => {
    const r = interpretUnblock("INFO 0 decision(s) deleted", "1.2.3.4");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("CrowdSec has no ban on 1.2.3.4 to remove.");
  });

  test("agent down and cscli errors keep their own messages", () => {
    expect(interpretUnblock(null, "1.2.3.4").error).toMatch(/isn't running/i);
    expect(interpretUnblock("Error: unable to delete", "1.2.3.4").error).toBe(
      "Error: unable to delete",
    );
  });

  test("output without a count ⇒ ok", () => {
    expect(interpretUnblock("", "1.2.3.4")).toEqual({ ok: true });
  });
});
