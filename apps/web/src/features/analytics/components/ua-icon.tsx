/**
 * One glyph per user-agent family, shared by every breakdown row that names a
 * browser, OS, device class or screen bucket (Traffic cards, the Overview
 * Devices card, the See-all table, Realtime rows). Lookup is a pure function
 * over the family name so both planes' vocabularies ("iOS", "iPadOS",
 * "Chromium", "bot", "Laptop") land on the same icon without either side
 * knowing about the other.
 *
 * Muted, hairline stroke, 14px: the icon identifies the row, the text is
 * still what you read.
 */

import type { IconSvgElement } from "@hugeicons/react";

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
import { HugeiconsIcon } from "@hugeicons/react";

export type UaKind = "browser" | "os" | "device" | "screen";

/** Ordered: the first pattern that matches wins, so "Chromium" lands on
 *  Chrome before anything more generic gets a look. */
const BROWSER_RULES: readonly [RegExp, IconSvgElement][] = [
  [/chrom(e|ium)/, ChromeIcon],
  [/safari/, SafariIcon],
];

const OS_RULES: readonly [RegExp, IconSvgElement][] = [
  [/mac\s?os|^ios$|ipados|iphone|ipad/, AppleIcon],
  [/windows/, WindowsNewIcon],
  [/android/, AndroidIcon],
  [/linux|ubuntu|debian|fedora|bsd/, ComputerTerminal01Icon],
];

const DEVICE_RULES: readonly [RegExp, IconSvgElement][] = [
  [/desktop/, ComputerIcon],
  [/mobile|phone/, SmartPhone01Icon],
  [/tablet/, Tablet01Icon],
  [/bot|crawler|spider/, BotIcon],
];

/** The tracker plane's screen buckets (query/filters.ts): Mobile / Tablet /
 *  Laptop / Desktop / Unknown. */
const SCREEN_RULES: readonly [RegExp, IconSvgElement][] = [
  [/desktop/, ComputerIcon],
  [/laptop/, LaptopIcon],
  [/tablet/, Tablet01Icon],
  [/mobile|phone/, SmartPhone01Icon],
];

const RULES: Record<UaKind, readonly [RegExp, IconSvgElement][]> = {
  browser: BROWSER_RULES,
  os: OS_RULES,
  device: DEVICE_RULES,
  screen: SCREEN_RULES,
};

const FALLBACK: Record<UaKind, IconSvgElement> = {
  browser: BrowserIcon,
  os: GlobeIcon,
  device: Globe02Icon,
  screen: Globe02Icon,
};

/** Family name → icon, case-insensitive; unknown families take the kind's
 *  generic glyph so the column never has a hole. */
export function uaIconFor(kind: UaKind, value: string): IconSvgElement {
  const needle = value.trim().toLowerCase();
  for (const [pattern, icon] of RULES[kind]) {
    if (pattern.test(needle)) return icon;
  }
  return FALLBACK[kind];
}

export function UaIcon({ kind, value }: { kind: UaKind; value: string }) {
  return (
    <HugeiconsIcon
      icon={uaIconFor(kind, value)}
      strokeWidth={1.5}
      aria-hidden="true"
      className="size-3.5 shrink-0 text-muted-foreground"
    />
  );
}
