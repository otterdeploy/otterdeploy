// .env parser/serializer for the bulk-edit dialog round-trip.
// Handles: `KEY=value`, `export KEY=value`, single/double quotes, comments
// starting with `#`, blank lines. Does NOT expand `${REF}` — those belong
// to the picker, not the source file.

export interface DotenvEntry {
  key: string;
  value: string;
}

const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

export function parseDotenv(input: string): DotenvEntry[] {
  const entries: DotenvEntry[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const key = m[1] ?? "";
    let value = m[2] ?? "";
    // Strip surrounding matching quotes. Inside double quotes, expand the
    // standard escape sequences a shell would. Single quotes are literal.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
    }
    entries.push({ key, value });
  }
  return entries;
}

// Serialize back to `KEY=value` lines. Quotes any value containing
// whitespace, newlines, `#`, or `=` so the result re-parses to the same
// entry. Keys are sorted for stable diffs.
export function serializeDotenv(entries: DotenvEntry[]): string {
  return [...entries]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ key, value }) => `${key}=${quoteIfNeeded(value)}`)
    .join("\n");
}

function quoteIfNeeded(value: string): string {
  if (value === "") return "";
  if (/[\s"'#=]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return value;
}
