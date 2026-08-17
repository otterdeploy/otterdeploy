/**
 * Shared user-agent primitives: the CLI-tool matcher, the well-known bot
 * list, the generic bot hint, and the OS-family sniff. Two consumers shape
 * these differently — the web's display classifier
 * (apps/web/src/features/edge-logs/components/edge-logs-ua.ts) renders
 * "Browser major / OS" strings, the API's analytics classifier
 * (packages/api/src/edge-logs/analytics-ua.ts) wants version-free families
 * plus a bot flag — but the recognition tables must stay identical or the
 * two surfaces disagree about what a bot is.
 */

/** CLI/HTTP tools, version captured (`[1]` = tool, `[2]` = version). Counted
 *  as bots by the analytics side: a curl hit is traffic, not a visitor. */
export const UA_CLI_TOOLS =
  /^(curl|wget|httpie|python-requests|python-urllib|go-http-client|node-fetch|node|undici|axios|okhttp|java|libwww-perl|deno|bun|postmanruntime|insomnia)[/ ](\d[\d.]*)/i;

/** Well-known crawler / webhook agents, matched anywhere in the string. */
export const UA_KNOWN_BOTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/googlebot/i, "Googlebot"],
  [/bingbot/i, "Bingbot"],
  [/duckduckbot/i, "DuckDuckBot"],
  [/yandex(bot)?/i, "YandexBot"],
  [/baiduspider/i, "Baiduspider"],
  [/ahrefsbot/i, "AhrefsBot"],
  [/semrushbot/i, "SemrushBot"],
  [/facebookexternalhit|meta-externalagent/i, "Facebook"],
  [/twitterbot/i, "Twitterbot"],
  [/slackbot|slack-imgproxy/i, "Slackbot"],
  [/discordbot/i, "Discordbot"],
  [/telegrambot/i, "TelegramBot"],
  [/applebot/i, "Applebot"],
  [/gptbot/i, "GPTBot"],
  [/claudebot|anthropic/i, "ClaudeBot"],
  [/stripe/i, "Stripe"],
  [/github-hookshot/i, "GitHub hooks"],
  [/uptimerobot/i, "UptimeRobot"],
  [/pingdom/i, "Pingdom"],
];

/** Generic crawler hint, applied only after the specific tables. No leading
 *  \b: "bot" is usually the END of a compound name (Googlebot, FooBot), so
 *  only the right edge is anchored. */
export const UA_GENERIC_BOT = /(bot|crawler|spider)(?![a-z])/i;

export function uaOsFamily(ua: string): string | null {
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/windows nt/i.test(ua)) return "Windows";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux|x11/i.test(ua)) return "Linux";
  return null;
}
