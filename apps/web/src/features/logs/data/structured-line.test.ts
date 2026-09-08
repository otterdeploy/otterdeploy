import { describe, expect, test } from "vite-plus/test";

import { fieldText, parseStructuredLine } from "./structured-line";

describe("parseStructuredLine", () => {
  test("a pino line reads as its message, level and time", () => {
    // The exact shape the runtime logs were rendering raw, one row per line.
    const line = `{"level":"warn","ts":"2026-09-08T21:30:34.425Z","msg":"sql handle: did not refresh database connection pool"}`;
    expect(parseStructuredLine(line)).toEqual({
      message: "sql handle: did not refresh database connection pool",
      level: "warn",
      tsMs: Date.parse("2026-09-08T21:30:34.425Z"),
      fields: [],
    });
  });

  test("numeric levels are ranges, not equalities", () => {
    // Pino writes the floor of a range; a custom level at 35 is still info.
    expect(parseStructuredLine('{"level":50,"msg":"x"}')?.level).toBe("error");
    expect(parseStructuredLine('{"level":35,"msg":"x"}')?.level).toBe("info");
    expect(parseStructuredLine('{"level":10,"msg":"x"}')?.level).toBe("trace");
  });

  test("the remaining fields are kept, in the order they were written", () => {
    const line = `{"level":"error","msg":"Operation failed","service":"frontend","error":"ListNamespaces failed","attempt":3}`;
    expect(parseStructuredLine(line)?.fields).toEqual([
      ["service", "frontend"],
      ["error", "ListNamespaces failed"],
      ["attempt", 3],
    ]);
  });

  test("pipeline stamps are dropped, so the row is not three copies of the host", () => {
    const line = `{"level":30,"time":1767304234425,"pid":1,"hostname":"a1b2c3","v":1,"msg":"ready"}`;
    expect(parseStructuredLine(line)).toEqual({
      message: "ready",
      level: "info",
      tsMs: 1767304234425,
      fields: [],
    });
  });

  test("seconds and millis are both timestamps", () => {
    expect(parseStructuredLine('{"msg":"x","time":1767304234}')?.tsMs).toBe(1767304234000);
    expect(parseStructuredLine('{"msg":"x","time":1767304234425}')?.tsMs).toBe(1767304234425);
  });

  test("an undeclared level stays null rather than defaulting to info", () => {
    // The caller's own content heuristic then runs. Defaulting here would paint
    // a stack trace calm.
    expect(parseStructuredLine('{"msg":"boom"}')?.level).toBeNull();
  });

  test("JSON that is not a log entry is left exactly as it was written", () => {
    // Output that happens to flow through a log stream — a config dump, an API
    // response — is data, not a sentence someone wrote for a human.
    expect(parseStructuredLine('{"host":"db","port":5432}')).toBeNull();
    expect(parseStructuredLine("[1,2,3]")).toBeNull();
    expect(parseStructuredLine('"just a string"')).toBeNull();
  });

  test("plain text is rejected on the first character, not by a failed parse", () => {
    expect(parseStructuredLine("Listening on :3000")).toBeNull();
    expect(parseStructuredLine("")).toBeNull();
    expect(parseStructuredLine("   ")).toBeNull();
    // Looks like JSON, is not: must not throw.
    expect(parseStructuredLine('{"level":"warn",}')).toBeNull();
    expect(parseStructuredLine("{oops}")).toBeNull();
  });

  test("other ecosystems' spellings are read too", () => {
    expect(parseStructuredLine('{"severity":"ERROR","message":"zap style"}')).toMatchObject({
      message: "zap style",
      level: "error",
    });
    expect(parseStructuredLine('{"lvl":"eror","msg":"logrus style"}')?.level).toBe("error");
  });
});

describe("fieldText", () => {
  test("scalars read as themselves", () => {
    expect(fieldText("frontend")).toBe("frontend");
    expect(fieldText(3)).toBe("3");
    expect(fieldText(true)).toBe("true");
    expect(fieldText(null)).toBe("null");
  });

  test("a shape says it is a shape rather than being flattened into the row", () => {
    // The detail panel prints it properly; the row would only truncate it.
    expect(fieldText({ a: 1 })).toBe("{…}");
    expect(fieldText([1, 2])).toBe("[2]");
  });
});
