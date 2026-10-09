/**
 * The Edge page read `SECRET-FILE /.env 200` as a leaked secret
 * when the 200 was the single-page app's index page. The tag stays (somebody
 * did probe for `/.env`) but the row says what actually came back.
 */
import { describe, expect, it } from "vite-plus/test";

import { readProbe } from "./access-cells";

const probe = { path: "/.env", status: 200, resBytes: 781 };

describe("readProbe", () => {
  it("says the file was not served when the answer was the index page", () => {
    const reading = readProbe({ ...probe, spaFallback: true });
    expect(reading?.category).toBe("secret-file");
    expect(reading?.fallback).toBe(true);
    expect(reading?.detail).toContain("index page");
    expect(reading?.detail).toContain("not served");
    expect(reading?.detail).toContain("781 B");
  });

  it("keeps the alarm for a probe that got something else", () => {
    const reading = readProbe({ ...probe, resBytes: 120, spaFallback: false });
    expect(reading?.fallback).toBe(false);
    expect(reading?.detail).toContain("Response 200");
    expect(reading?.detail).not.toContain("not served");
  });

  it("is silent about ordinary traffic", () => {
    expect(readProbe({ ...probe, path: "/about", spaFallback: false })).toBeNull();
  });
});
