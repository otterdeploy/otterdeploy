import {
  AndroidIcon,
  AppleIcon,
  BotIcon,
  BrowserIcon,
  ChromeIcon,
  ComputerIcon,
  ComputerTerminal01Icon,
  Globe02Icon,
  GlobeIcon,
  LaptopIcon,
  SafariIcon,
  SmartPhone01Icon,
  Tablet01Icon,
  WindowsNewIcon,
} from "@hugeicons/core-free-icons";
import { describe, expect, it } from "vite-plus/test";

import { uaIconFor } from "./ua-icon";

describe("uaIconFor", () => {
  it("maps browser families case-insensitively and falls back to the generic browser", () => {
    expect(uaIconFor("browser", "Chrome")).toBe(ChromeIcon);
    expect(uaIconFor("browser", "chromium")).toBe(ChromeIcon);
    expect(uaIconFor("browser", "Mobile Safari")).toBe(SafariIcon);
    expect(uaIconFor("browser", "Firefox")).toBe(BrowserIcon);
    expect(uaIconFor("browser", "")).toBe(BrowserIcon);
  });

  it("maps OS families, Apple platforms together, and unknowns to the globe", () => {
    expect(uaIconFor("os", "macOS")).toBe(AppleIcon);
    expect(uaIconFor("os", "Mac OS")).toBe(AppleIcon);
    expect(uaIconFor("os", "iOS")).toBe(AppleIcon);
    expect(uaIconFor("os", "iPadOS")).toBe(AppleIcon);
    expect(uaIconFor("os", "Windows")).toBe(WindowsNewIcon);
    expect(uaIconFor("os", "android")).toBe(AndroidIcon);
    expect(uaIconFor("os", "Linux")).toBe(ComputerTerminal01Icon);
    expect(uaIconFor("os", "Ubuntu")).toBe(ComputerTerminal01Icon);
    expect(uaIconFor("os", "FreeBSD")).toBe(ComputerTerminal01Icon);
    expect(uaIconFor("os", "Chrome OS")).toBe(GlobeIcon);
  });

  it("maps device classes from both planes' vocabularies", () => {
    expect(uaIconFor("device", "desktop")).toBe(ComputerIcon);
    expect(uaIconFor("device", "Desktop")).toBe(ComputerIcon);
    expect(uaIconFor("device", "mobile")).toBe(SmartPhone01Icon);
    expect(uaIconFor("device", "tablet")).toBe(Tablet01Icon);
    expect(uaIconFor("device", "bot")).toBe(BotIcon);
    expect(uaIconFor("device", "other")).toBe(Globe02Icon);
  });

  it("maps the tracker's screen buckets, laptops included", () => {
    expect(uaIconFor("screen", "Desktop")).toBe(ComputerIcon);
    expect(uaIconFor("screen", "Laptop")).toBe(LaptopIcon);
    expect(uaIconFor("screen", "Tablet")).toBe(Tablet01Icon);
    expect(uaIconFor("screen", "Mobile")).toBe(SmartPhone01Icon);
    expect(uaIconFor("screen", "Unknown")).toBe(Globe02Icon);
  });
});
