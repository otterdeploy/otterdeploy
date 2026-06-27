/**
 * Parses Railway-style variable references in env-var values.
 *
 *   ${{<ResourceName>.<VAR>}}
 *
 * Escaping: `\${{` becomes a literal `${{` in the output.
 *
 *   ResourceName  matches [A-Za-z][A-Za-z0-9_-]*
 *   VAR           matches [A-Z_][A-Z0-9_]*
 */

export interface RefToken {
  kind: "ref";
  resource: string;
  var: string;
  raw: string; // original substring including `${{` and `}}`
}

export interface LiteralToken {
  kind: "literal";
  value: string;
}

export type Token = RefToken | LiteralToken;

export interface ParseError {
  kind: "parse_error";
  message: string;
  position: number;
}

export type ParseResult = { ok: true; tokens: Token[] } | { ok: false; error: ParseError };

const RESOURCE_NAME = /^[A-Za-z][A-Za-z0-9_-]*/;
const VAR_NAME = /^[A-Z_][A-Z0-9_]*/;

export function parseValue(input: string): ParseResult {
  const tokens: Token[] = [];
  let literal = "";
  let i = 0;

  const flushLiteral = () => {
    if (literal.length > 0) {
      tokens.push({ kind: "literal", value: literal });
      literal = "";
    }
  };

  while (i < input.length) {
    // Escaped reference: \${{ → literal ${{
    if (input[i] === "\\" && input.startsWith("${{", i + 1)) {
      literal += "${{";
      i += 4;
      continue;
    }

    // Reference start: ${{
    if (input.startsWith("${{", i)) {
      const start = i;
      i += 3;

      const resourceMatch = input.slice(i).match(RESOURCE_NAME);
      if (!resourceMatch) {
        return {
          ok: false,
          error: {
            kind: "parse_error",
            message: "expected resource name after `${{`",
            position: i,
          },
        };
      }
      const resourceName = resourceMatch[0];
      i += resourceName.length;

      if (input[i] !== ".") {
        return {
          ok: false,
          error: {
            kind: "parse_error",
            message: "expected `.` between resource and variable name",
            position: i,
          },
        };
      }
      i += 1;

      const varMatch = input.slice(i).match(VAR_NAME);
      if (!varMatch) {
        return {
          ok: false,
          error: {
            kind: "parse_error",
            message: "expected SCREAMING_SNAKE_CASE variable name",
            position: i,
          },
        };
      }
      const varName = varMatch[0];
      i += varName.length;

      if (!input.startsWith("}}", i)) {
        return {
          ok: false,
          error: {
            kind: "parse_error",
            message: "expected closing `}}`",
            position: i,
          },
        };
      }
      i += 2;

      flushLiteral();
      tokens.push({
        kind: "ref",
        resource: resourceName,
        var: varName,
        raw: input.slice(start, i),
      });
      continue;
    }

    literal += input[i];
    i += 1;
  }

  flushLiteral();
  return { ok: true, tokens };
}

/** Convenience: list every reference in a value, deduplicated by (resource, var). */
export function extractRefs(input: string): RefToken[] {
  const result = parseValue(input);
  if (!result.ok) return [];
  const seen = new Set<string>();
  const refs: RefToken[] = [];
  for (const token of result.tokens) {
    if (token.kind !== "ref") continue;
    const key = `${token.resource}.${token.var}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(token);
  }
  return refs;
}
