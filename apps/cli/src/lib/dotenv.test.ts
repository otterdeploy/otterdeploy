import { describe, expect, it } from "vite-plus/test";

import { parseDotenv, parsePairs } from "./dotenv";

describe("parsePairs", () => {
  it("reads KEY=VAL tokens and skips flags and bare words", () => {
    expect(parsePairs(["A=1", "--service", "web", "B=two", "notapair"])).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "two" },
    ]);
  });

  it("keeps '=' inside values", () => {
    expect(parsePairs(["URL=postgres://u:p@h/db?x=1"])).toEqual([
      { key: "URL", value: "postgres://u:p@h/db?x=1" },
    ]);
  });

  it("drops an empty key", () => {
    expect(parsePairs(["=oops"])).toEqual([]);
  });
});

describe("parseDotenv", () => {
  it("skips comments and blank lines", () => {
    const body = "# comment\n\nFOO=bar\n  \nBAZ=qux\n";
    expect(parseDotenv(body)).toEqual([
      { key: "FOO", value: "bar" },
      { key: "BAZ", value: "qux" },
    ]);
  });

  it("strips matching surrounding quotes", () => {
    expect(parseDotenv(`A="quoted"\nB='single'\nC=plain`)).toEqual([
      { key: "A", value: "quoted" },
      { key: "B", value: "single" },
      { key: "C", value: "plain" },
    ]);
  });

  it("trims whitespace around key and value", () => {
    expect(parseDotenv("  KEY  =  value  ")).toEqual([{ key: "KEY", value: "value" }]);
  });

  it("handles CRLF line endings", () => {
    expect(parseDotenv("A=1\r\nB=2")).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "2" },
    ]);
  });
});
