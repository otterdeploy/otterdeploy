/**
 * Read-only YAML view with a line-number gutter + lightweight token
 * coloring (comments, keys, strings, numbers, booleans). Intentionally
 * no editor dependency yet — once Step 2 lands and this becomes
 * editable we can swap in CodeMirror without changing the panel shell.
 */

import { Fragment, useMemo } from "react";

import { cn } from "@/shared/lib/utils";

export interface YamlViewProps {
  source: string;
  className?: string;
}

interface Token {
  text: string;
  kind: TokenKind;
}
type TokenKind =
  | "comment"
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "punct"
  | "plain";

const KIND_CLASS: Record<TokenKind, string> = {
  comment: "text-muted-foreground/55 italic",
  key: "text-sky-300/90",
  string: "text-emerald-300/85",
  number: "text-orange-300/85",
  boolean: "text-violet-300/85",
  punct: "text-muted-foreground/70",
  plain: "text-foreground/85",
};

function tokenize(line: string): Token[] {
  // Hash comments win — the rest of the line is a single comment token.
  const hash = line.indexOf("#");
  if (hash >= 0) {
    const before = line.slice(0, hash);
    const comment = line.slice(hash);
    return [...tokenizeNonComment(before), { text: comment, kind: "comment" }];
  }
  return tokenizeNonComment(line);
}

function tokenizeNonComment(line: string): Token[] {
  const tokens: Token[] = [];
  // Key: leading whitespace + identifier + colon.
  const keyMatch = line.match(/^(\s*[-?\s]*)([A-Za-z0-9_./-]+)(:)(.*)$/);
  if (keyMatch) {
    const [, lead, key, colon, rest] = keyMatch;
    if (lead) tokens.push({ text: lead, kind: "plain" });
    tokens.push({ text: key, kind: "key" });
    tokens.push({ text: colon, kind: "punct" });
    tokens.push(...tokenizeValue(rest));
    return tokens;
  }
  return tokenizeValue(line);
}

function tokenizeValue(value: string): Token[] {
  if (!value) return [];
  // Quoted string runs as a single token; everything else gets a coarse
  // classification by trim.
  const quoted = value.match(/^(\s*)("[^"]*"|'[^']*')(.*)$/);
  if (quoted) {
    const [, lead, str, rest] = quoted;
    const out: Token[] = [];
    if (lead) out.push({ text: lead, kind: "plain" });
    out.push({ text: str, kind: "string" });
    if (rest) out.push(...tokenizeValue(rest));
    return out;
  }
  const trimmed = value.trim();
  if (trimmed === "true" || trimmed === "false" || trimmed === "null") {
    return [{ text: value, kind: "boolean" }];
  }
  if (/^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    return [{ text: value, kind: "number" }];
  }
  return [{ text: value, kind: "plain" }];
}

export function YamlView({ source, className }: YamlViewProps) {
  const lines = useMemo(() => source.split("\n"), [source]);
  const gutterWidth = String(lines.length).length;
  return (
    <pre
      className={cn(
        "h-full overflow-auto font-mono text-[12px] leading-[1.55]",
        className,
      )}
    >
      <code className="block min-w-max px-3 py-2">
        {lines.map((line, idx) => (
          <Fragment key={idx}>
            <span className="select-none pr-4 text-right text-muted-foreground/40 tabular-nums">
              {String(idx + 1).padStart(gutterWidth, " ")}
            </span>
            {tokenize(line).map((tok, i) => (
              <span key={i} className={KIND_CLASS[tok.kind]}>
                {tok.text}
              </span>
            ))}
            {"\n"}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}
