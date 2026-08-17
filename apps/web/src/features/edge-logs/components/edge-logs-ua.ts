/**
 * Tiny dependency-free user-agent classifier for the collapsed-row UA column.
 * Collapses the mile-long UA string into "Browser major / OS" (the demo's
 * `uaShort`), passes CLI tools and known bots through by name, and truncates
 * anything unrecognized. The full string stays available via `title` and the
 * expanded detail grid.
 */

import { UA_CLI_TOOLS, UA_GENERIC_BOT, UA_KNOWN_BOTS, uaOsFamily } from "@otterdeploy/shared/ua";

/** `name/1.2.3` → "name/1.2" (major.minor is enough to tell versions apart). */
function tool(name: string, version?: string): string {
  if (!version) return name;
  const [major, minor] = version.split(".");
  return minor != null ? `${name}/${major}.${minor}` : `${name}/${major}`;
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
  if (!s) return "–";

  const cli = UA_CLI_TOOLS.exec(s);
  const cliName = cli?.[1];
  if (cli && cliName) return tool(cliName.toLowerCase(), cli[2]);

  for (const [re, name] of UA_KNOWN_BOTS) if (re.test(s)) return name;

  const b = browser(s);
  if (b) {
    const os = uaOsFamily(s);
    return os ? `${b} / ${os}` : b;
  }

  // Generic crawler hint after the specific list ("Mozilla/5.0 (compatible;
  // FooBot/1.0)"-style agents).
  if (UA_GENERIC_BOT.test(s)) return "bot";

  // Fallback: the first product token ("thing/1.2 extra…" → "thing/1.2"),
  // else a hard truncation.
  const token = /^([\w.-]+)\/(\d[\d.]*)/.exec(s);
  const tokenName = token?.[1];
  if (token && tokenName) return tool(tokenName, token[2]);
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}
