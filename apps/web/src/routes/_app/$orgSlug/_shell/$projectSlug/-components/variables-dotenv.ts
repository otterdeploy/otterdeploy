/**
 * .env parsing + serialization shared by the Variables surfaces:
 * the bulk-edit dialog (paste / inline edit), the drag-drop .env import
 * (prefills bulk edit), and the per-env Download .env export.
 */

export interface ParsedVar {
  key: string;
  value: string;
  isSecret: boolean;
}

/** Heuristic used to pre-mark pasted/imported keys as secret. */
const SECRET_KEY_RE = /SECRET|KEY|TOKEN|PASS|DSN/i;

export function parseDotEnv(text: string): ParsedVar[] {
  const out: ParsedVar[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k.startsWith("export ")) k = k.slice(7).trim();
    out.push({ key: k, value: v, isSecret: SECRET_KEY_RE.test(k) });
  }
  return out;
}

/**
 * Serialize rows to .env text, preserving input order. Values that contain
 * whitespace (incl. newlines), `#`, quotes, or backslashes are wrapped in
 * double quotes with `"` `\` and newlines escaped; everything else is
 * written bare as `KEY=VALUE`.
 */
export function serializeDotEnv(vars: { key: string; value: string }[]): string {
  if (vars.length === 0) return "";
  return `${vars.map(({ key, value }) => `${key}=${serializeValue(value)}`).join("\n")}\n`;
}

function serializeValue(value: string): string {
  if (!/[\s#"'\\]/.test(value)) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}
