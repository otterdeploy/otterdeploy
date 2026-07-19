/**
 * Read-only JSON view with lightweight syntax coloring (keys, strings,
 * numbers, booleans, null, punctuation). Dependency-free — mirrors the token
 * palette of the stack's YamlView so highlighted JSON and YAML look of a
 * piece. Pretty-prints `data` with two-space indent and preserves the
 * caller's container styling via `className`.
 */

import { cn } from "@/shared/lib/utils";

export interface JsonViewProps {
  /** Any JSON-serialisable value. Rendered via `JSON.stringify(data, null, 2)`. */
  data: unknown;
  className?: string;
}

type JsonTokenKind = "key" | "string" | "number" | "boolean" | "null" | "punct";

const KIND_CLASS: Record<JsonTokenKind, string> = {
  key: "text-sky-300/90",
  string: "text-emerald-300/85",
  number: "text-orange-300/85",
  boolean: "text-violet-300/85",
  null: "text-muted-foreground/60",
  punct: "text-muted-foreground/70",
};

interface JsonToken {
  text: string;
  kind: JsonTokenKind;
}

// One quoted string (a key when followed by `:`), a literal, or a number.
// Whatever sits between matches (braces, commas, colons, whitespace, newlines)
// is emitted as a `punct` span — harmless for whitespace, muted for structure.
const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function tokenizeJson(src: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    if (m.index > last) {
      tokens.push({ text: src.slice(last, m.index), kind: "punct" });
    }
    const full = m[0];
    const str = m[1];
    const colon = m[2];
    if (str !== undefined) {
      if (colon !== undefined) {
        tokens.push({ text: str, kind: "key" });
        tokens.push({ text: colon, kind: "punct" });
      } else {
        tokens.push({ text: str, kind: "string" });
      }
    } else if (full === "true" || full === "false") {
      tokens.push({ text: full, kind: "boolean" });
    } else if (full === "null") {
      tokens.push({ text: full, kind: "null" });
    } else {
      tokens.push({ text: full, kind: "number" });
    }
    last = m.index + full.length;
  }
  if (last < src.length) tokens.push({ text: src.slice(last), kind: "punct" });
  return tokens;
}

export function JsonView({ data, className }: JsonViewProps) {
  let src: string;
  try {
    src = JSON.stringify(data, null, 2) ?? "null";
  } catch {
    src = String(data);
  }
  const tokens = tokenizeJson(src);

  return (
    <pre className={cn("overflow-auto font-mono leading-relaxed", className)}>
      <code className="block min-w-max">
        {tokens.map((tok, i) => (
          <span key={i} className={KIND_CLASS[tok.kind]}>
            {tok.text}
          </span>
        ))}
      </code>
    </pre>
  );
}
