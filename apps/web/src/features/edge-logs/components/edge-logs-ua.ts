/**
 * Tiny dependency-free user-agent classifier for the collapsed-row UA column.
 * Collapses the mile-long UA string into "Browser major / OS" (the demo's
 * `uaShort`), passes CLI tools and known bots through by name, and truncates
 * anything unrecognized. The full string stays available via `title` and the
 * expanded detail grid.
 */

/** `name/1.2.3` → "name/1.2" (major.minor is enough to tell versions apart). */
function tool(name: string, version?: string): string {
  if (!version) return name;
  const [major, minor] = version.split(".");
  return minor != null ? `${name}/${major}.${minor}` : `${name}/${major}`;
}

const CLI_TOOLS =
  /^(curl|wget|httpie|python-requests|python-urllib|go-http-client|node-fetch|node|undici|axios|okhttp|java|libwww-perl|deno|bun|postmanruntime|insomnia)[/ ](\d[\d.]*)/i;

/** Well-known crawler / webhook agents, matched anywhere in the string. */
const KNOWN_BOTS: Array<[RegExp, string]> = [
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

function osFamily(ua: string): string | null {
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/windows nt/i.test(ua)) return "Windows";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux|x11/i.test(ua)) return "Linux";
  return null;
}

function major(v: string | undefined): string | null {
  const m = v?.split(".")[0];
  return m && /^\d+$/.test(m) ? m : null;
}

/** Browser name + major version. Order matters: Edge and Opera embed
 *  "Chrome/", Chrome embeds "Safari/", so match the most specific first. */
function browser(ua: string): string | null {
  const edge = /edg(?:e|a|ios)?\/([\d.]+)/i.exec(ua);
  if (edge) return `Edge ${major(edge[1]) ?? ""}`.trim();
  const opera = /(?:opr|opera)\/([\d.]+)/i.exec(ua);
  if (opera) return `Opera ${major(opera[1]) ?? ""}`.trim();
  const firefox = /(?:firefox|fxios)\/([\d.]+)/i.exec(ua);
  if (firefox) return `Firefox ${major(firefox[1]) ?? ""}`.trim();
  const chrome = /(?:chrome|crios)\/([\d.]+)/i.exec(ua);
  if (chrome) return `Chrome ${major(chrome[1]) ?? ""}`.trim();
  if (/safari\//i.test(ua)) {
    const version = /version\/([\d.]+)/i.exec(ua);
    return `Safari ${major(version?.[1]) ?? ""}`.trim();
  }
  return null;
}

export function shortUserAgent(ua: string): string {
  const s = ua.trim();
  if (!s) return "—";

  const cli = CLI_TOOLS.exec(s);
  const cliName = cli?.[1];
  if (cli && cliName) return tool(cliName.toLowerCase(), cli[2]);

  for (const [re, name] of KNOWN_BOTS) if (re.test(s)) return name;

  const b = browser(s);
  if (b) {
    const os = osFamily(s);
    return os ? `${b} / ${os}` : b;
  }

  // Generic crawler hint after the specific list ("Mozilla/5.0 (compatible;
  // FooBot/1.0)"-style agents). No leading \b — "bot" is usually the *end* of
  // a compound name (Googlebot, FooBot), so only the right edge is anchored.
  if (/(bot|crawler|spider)(?![a-z])/i.test(s)) return "bot";

  // Fallback: the first product token ("thing/1.2 extra…" → "thing/1.2"),
  // else a hard truncation.
  const token = /^([\w.-]+)\/(\d[\d.]*)/.exec(s);
  const tokenName = token?.[1];
  if (token && tokenName) return tool(tokenName, token[2]);
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}
