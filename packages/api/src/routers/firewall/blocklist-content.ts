import { isIP } from "node:net";

const MAX_ENTRIES = 250_000;
const MAX_LINE_LENGTH = 256;

export class InvalidBlocklistContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBlocklistContentError";
  }
}

function validIpOrCidr(value: string): boolean {
  const [address, prefixText, extra] = value.split("/");
  if (!address || extra !== undefined) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefixText === undefined) return true;
  if (!/^\d{1,3}$/.test(prefixText)) return false;
  const prefix = Number(prefixText);
  return prefix >= 0 && prefix <= (family === 4 ? 32 : 128);
}

/**
 * Reduce a remote list to a deduplicated newline-delimited IP/CIDR payload.
 * Comments and blank lines are accepted; every other line must begin with a
 * valid address. This supports Spamhaus-style `CIDR ; comment` records while
 * refusing HTML, domains, commands, and malformed ranges.
 */
export function parseBlocklistContent(raw: string): string[] {
  const entries = new Set<string>();
  for (const originalLine of raw.split(/\r?\n/)) {
    if (originalLine.length > MAX_LINE_LENGTH) {
      throw new InvalidBlocklistContentError("A blocklist line is too long.");
    }
    const line = originalLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const [value] = line.split(/\s|;/, 1);
    if (!value) continue;
    if (!validIpOrCidr(value)) {
      throw new InvalidBlocklistContentError(`Invalid IP/CIDR entry: ${value.slice(0, 80)}`);
    }
    entries.add(value);
    if (entries.size > MAX_ENTRIES) {
      throw new InvalidBlocklistContentError(`Blocklist exceeds ${MAX_ENTRIES} entries.`);
    }
  }
  if (entries.size === 0) {
    throw new InvalidBlocklistContentError("Blocklist contains no valid IP/CIDR entries.");
  }
  return [...entries];
}
