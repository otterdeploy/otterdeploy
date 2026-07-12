/**
 * Small parsers shared by the env commands:
 *   - `parsePairs` reads `KEY=VAL` tokens from raw argv (flags skipped).
 *   - `parseDotenv` reads a dotenv file body (comments/blanks skipped,
 *     surrounding single/double quotes stripped).
 * Both keep the last occurrence's value out of the loop — callers dedupe.
 */

export interface EnvPair {
  key: string;
  value: string;
}

export function parsePairs(rawArgs: string[]): EnvPair[] {
  const out: EnvPair[] = [];
  for (const arg of rawArgs) {
    if (arg.startsWith("-")) continue;
    const idx = arg.indexOf("=");
    if (idx === -1) continue;
    const key = arg.slice(0, idx);
    const value = arg.slice(idx + 1);
    if (key) out.push({ key, value });
  }
  return out;
}

export function parseDotenv(body: string): EnvPair[] {
  const out: EnvPair[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out.push({ key, value });
  }
  return out;
}
