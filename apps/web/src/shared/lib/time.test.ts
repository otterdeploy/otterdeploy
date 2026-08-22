/**
 * The point of these is the last block: the same call renders in the
 * operator's language. Everything above it pins the ENGLISH output, because
 * this replaced ten hand-rolled formatters and "now localized" would be a bad
 * trade if it also silently reworded every English surface.
 */
import { i18n } from "@otterdeploy/i18n/web";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { humanizeSeconds, relativeMs, relativeSeconds, timeAgo } from "./time";

const original = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(original);
});

describe("humanizeSeconds", () => {
  it("reads in the two most significant units", () => {
    expect(humanizeSeconds(29 * 86_400 + 21 * 3600 + 30 * 60)).toBe("29d 21h");
    expect(humanizeSeconds(19 * 3600 + 64)).toBe("19h 1m");
    expect(humanizeSeconds(42 * 60 + 10)).toBe("42m");
  });

  it("drops a zero trailing unit rather than padding it", () => {
    expect(humanizeSeconds(30 * 86_400)).toBe("30d");
    expect(humanizeSeconds(2 * 3600)).toBe("2h");
  });

  it("collapses sub-minute spans instead of showing a stopped clock", () => {
    expect(humanizeSeconds(30)).toBe("<1m");
    expect(humanizeSeconds(0)).toBe("<1m");
  });
});

describe("relativeSeconds", () => {
  it("reads the past as ago and the future as in", () => {
    expect(relativeSeconds(-3 * 86_400)).toBe("3 days ago");
    expect(relativeSeconds(3 * 86_400)).toBe("in 3 days");
  });

  it("uses the language's own word where it has one", () => {
    // This is what `numeric: "auto"` buys, and what a template string can't.
    expect(relativeSeconds(-86_400)).toBe("yesterday");
  });

  it("picks the largest unit the span reaches", () => {
    expect(relativeSeconds(-45)).toBe("45 seconds ago");
    expect(relativeSeconds(-42 * 60)).toBe("42 minutes ago");
    expect(relativeSeconds(-5 * 3600)).toBe("5 hours ago");
  });
});

describe("relativeMs / timeAgo", () => {
  it("reads an instant relative to now", () => {
    expect(relativeMs(Date.now() - 5 * 3600 * 1000)).toBe("5 hours ago");
  });

  it("passes an unparseable string through rather than printing Invalid Date", () => {
    expect(timeAgo("not-a-date")).toBe("not-a-date");
  });
});

describe("the operator's language", () => {
  it("follows the app's language, not the runtime's", async () => {
    await i18n.changeLanguage("de");
    expect(humanizeSeconds(19 * 3600 + 64)).toBe("19h 1min");
    expect(relativeSeconds(-3 * 86_400)).toBe("vor 3 Tagen");

    await i18n.changeLanguage("es");
    expect(humanizeSeconds(19 * 3600 + 64)).toBe("19 h 1 min");
    expect(relativeSeconds(-3 * 86_400)).toBe("hace 3 días");

    await i18n.changeLanguage("en");
    expect(relativeSeconds(-3 * 86_400)).toBe("3 days ago");
  });
});
