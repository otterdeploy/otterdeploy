import { describe, expect, test } from "vite-plus/test";

import { parseBlocklistContent } from "../blocklist-content";

describe("parseBlocklistContent", () => {
  test("accepts IPv4, IPv6, CIDRs, comments and Spamhaus annotations", () => {
    expect(
      parseBlocklistContent(`
        # comment
        1.2.3.4
        10.20.0.0/16 ; SBL123
        2001:4860:4860::8888
        2001:db8::/32 extra-column
        1.2.3.4
      `),
    ).toEqual(["1.2.3.4", "10.20.0.0/16", "2001:4860:4860::8888", "2001:db8::/32"]);
  });

  test.each(["<html>login</html>", "example.com", "1.2.3.4/33", "2001:db8::/129", "1.2.3.4/24/1"])(
    "rejects malformed or non-address content: %s",
    (content) => {
      expect(() => parseBlocklistContent(content)).toThrow("Invalid IP/CIDR");
    },
  );

  test("drops annotations rather than forwarding them to the shell/importer", () => {
    expect(parseBlocklistContent("1.2.3.4;touch /tmp/pwn")).toEqual(["1.2.3.4"]);
  });

  test("rejects empty/comment-only and oversized lines", () => {
    expect(() => parseBlocklistContent("# only\n; comments")).toThrow("no valid");
    expect(() => parseBlocklistContent("1".repeat(257))).toThrow("too long");
  });
});
