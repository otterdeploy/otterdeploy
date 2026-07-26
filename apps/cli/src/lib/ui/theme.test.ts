import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { bold, colorEnabled, padEnd, padStart, paint, refreshTheme, width } from "./theme";

// oxlint-disable-next-line node/no-process-env -- the module under test reads env
const env = process.env;

const SAVED = { ...env };

function setEnv(next: Record<string, string | undefined>): void {
  for (const key of ["NO_COLOR", "FORCE_COLOR", "TERM", "COLORTERM"]) delete env[key];
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) env[key] = value;
  }
  refreshTheme();
}

beforeEach(() => {
  setEnv({ FORCE_COLOR: "1" });
});

afterEach(() => {
  for (const key of ["NO_COLOR", "FORCE_COLOR", "TERM", "COLORTERM"]) delete env[key];
  for (const [key, value] of Object.entries(SAVED)) {
    if (value !== undefined) env[key] = value;
  }
  refreshTheme();
});

describe("colour capability", () => {
  it("emits no escapes when NO_COLOR is set", () => {
    setEnv({ NO_COLOR: "1" });
    expect(colorEnabled()).toBe(false);
    expect(paint("danger", "boom")).toBe("boom");
    expect(bold("hi")).toBe("hi");
  });

  it("emits 24-bit colour when the terminal reports truecolor", () => {
    setEnv({ FORCE_COLOR: "1", COLORTERM: "truecolor" });
    // destructive-dark #f87171 → 248,113,113
    expect(paint("danger", "x")).toContain("38;2;248;113;113");
  });

  it("falls back to a 256-colour index for TERM=*-256color", () => {
    setEnv({ FORCE_COLOR: "1", TERM: "xterm-256color" });
    // 256-colour form is `38;5;<index>`, never `38;2;r;g;b`.
    expect(paint("accent", "x")).toContain("38;5;75");
    expect(paint("accent", "x")).not.toContain("38;2;");
  });

  it("falls back to 16-colour SGR for a plain TERM", () => {
    setEnv({ FORCE_COLOR: "1", TERM: "xterm" });
    expect(paint("ok", "x")).toContain("[92m");
  });

  it("never paints an empty string", () => {
    expect(paint("ok", "")).toBe("");
  });
});

describe("ANSI-safe measurement", () => {
  it("measures printable width, ignoring escapes", () => {
    setEnv({ FORCE_COLOR: "1", COLORTERM: "truecolor" });
    const painted = paint("accent", "abc");
    expect(painted.length).toBeGreaterThan(3);
    expect(width(painted)).toBe(3);
  });

  it("pads a painted cell to its printable width", () => {
    setEnv({ FORCE_COLOR: "1", COLORTERM: "truecolor" });
    const painted = paint("ok", "ab");
    // This is the bug the helper exists to prevent: String.padEnd would count
    // the ~10 invisible escape bytes and under-pad the column.
    expect(width(padEnd(painted, 5))).toBe(5);
    expect(width(padStart(painted, 5))).toBe(5);
  });

  it("leaves over-long text alone rather than truncating", () => {
    expect(padEnd("abcdef", 3)).toBe("abcdef");
  });
});
