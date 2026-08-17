/**
 * Server-side user-agent classifier for the analytics accumulator. Ported from
 * the web's display classifier (apps/web/src/features/edge-logs/components/
 * edge-logs-ua.ts) but shaped for aggregation: family names without versions
 * (versions explode jsonb key cardinality for no analytical value) plus a
 * `bot` flag that gates visitor counting. Unifying the two into a shared
 * package is a tracked follow-up; the web one is display-oriented.
 *
 * Wrapped in a bounded memo: real traffic has few distinct UA strings, so the
 * per-line cost is a Map hit, not a regex battery. Under an adversarial
 * rotating-UA flood the memo evicts and classification runs per line, which is
 * still a bounded, small regex count.
 */

import { UA_CLI_TOOLS, UA_GENERIC_BOT, UA_KNOWN_BOTS, uaOsFamily } from "@otterdeploy/shared/ua";

export interface UaClass {
  /** Browser family ("Chrome", "Safari", …) or null for non-browsers. */
  browser: string | null;
  /** OS family ("Windows", "iOS", …) or null when unrecognized. */
  os: string | null;
  deviceType: "desktop" | "mobile" | "tablet" | "bot" | "other";
  /** Crawlers, webhooks, monitors AND CLI tools: excluded from visitors. */
  bot: boolean;
}

/** Browser family. Order matters: Edge and Opera embed "Chrome/", Chrome
 *  embeds "Safari/", so match the most specific first. */
function browserFamily(ua: string): string | null {
  if (/edg(?:e|a|ios)?\/[\d.]/i.test(ua)) return "Edge";
  if (/(?:opr|opera)\/[\d.]/i.test(ua)) return "Opera";
  if (/(?:firefox|fxios)\/[\d.]/i.test(ua)) return "Firefox";
  if (/(?:chrome|crios)\/[\d.]/i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua)) return "Safari";
  return null;
}

function deviceTypeOf(ua: string, os: string | null): UaClass["deviceType"] {
  if (/ipad/i.test(ua)) return "tablet";
  if (/android/i.test(ua) && !/mobile/i.test(ua)) return "tablet";
  if (/iphone|ipod/i.test(ua) || /android/i.test(ua) || /mobile/i.test(ua)) return "mobile";
  if (os !== null) return "desktop";
  return "other";
}

function classify(uaRaw: string): UaClass {
  const ua = uaRaw.trim();
  if (!ua) return { browser: null, os: null, deviceType: "other", bot: false };

  if (UA_CLI_TOOLS.test(ua)) return { browser: null, os: null, deviceType: "bot", bot: true };
  for (const [re] of UA_KNOWN_BOTS) {
    if (re.test(ua)) return { browser: null, os: null, deviceType: "bot", bot: true };
  }

  const browser = browserFamily(ua);
  const os = uaOsFamily(ua);
  // The generic hint only after browser matching: "Chrome/…" agents that also
  // mention "bot" in a product token are overwhelmingly real bots, but a plain
  // browser UA never contains the token.
  if (browser === null && UA_GENERIC_BOT.test(ua)) {
    return { browser: null, os: null, deviceType: "bot", bot: true };
  }

  return { browser, os, deviceType: deviceTypeOf(ua, os), bot: false };
}

/** Bounded memo: distinct real-world UAs are few; eviction just re-classifies. */
const MEMO_MAX = 2_000;
const memo = new Map<string, UaClass>();

export function classifyUa(ua: string): UaClass {
  const hit = memo.get(ua);
  if (hit) return hit;
  const result = classify(ua);
  if (memo.size >= MEMO_MAX) {
    // Drop the oldest insertion; Map iterates in insertion order.
    const first = memo.keys().next();
    if (!first.done) memo.delete(first.value);
  }
  memo.set(ua, result);
  return result;
}

/** Test seam. */
export function __resetUaMemo(): void {
  memo.clear();
}
