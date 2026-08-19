import * as z from "zod";

/**
 * Raw per-route Caddyfile directives (od-f4rb, owner decision 2026-08-19).
 *
 * The text is spliced verbatim INSIDE the route's site block, so the schema's
 * job is structural integrity, not capability policing: a block must not be
 * able to close the enclosing site block and open a new one (which would let
 * a route claim other domains or redefine global options). Everything else —
 * whether the directives themselves are valid Caddyfile — is decided by the
 * real gate: the reconciler adapts the full generated config through Caddy's
 * own /adapt endpoint and rolls the row back if the edge rejects it, and
 * node-push re-validates with `caddy validate` before swapping the live file.
 */
export const MAX_CUSTOM_DIRECTIVES_LENGTH = 16_384;

/** C0 controls except tab/newline (and CR, normalized away), plus DEL: never
 *  legal in a Caddyfile and a smuggling vector in terminal/log output. */
const hasForbiddenControlChar = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x09 || code === 0x0a) continue;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

/**
 * Scan brace balance the way Caddy's lexer would: braces inside double-quoted
 * or backtick-quoted tokens are literal text, and a `#` outside quotes starts
 * a comment that runs to end of line. Returns the final depth, or -1 the
 * moment depth dips below zero (an escape from the enclosing site block).
 */
export function caddyBraceBalance(text: string): number {
  let depth = 0;
  let quote: '"' | "`" | null = null;
  let comment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (comment) {
      if (ch === "\n") comment = false;
      continue;
    }
    if (quote !== null) {
      if (ch === "\\" && quote === '"')
        i++; // skip escaped char inside "…"
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "`") quote = ch;
    else if (ch === "#") comment = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) return -1;
    }
  }
  return depth;
}

export const customDirectivesSchema = z
  .string()
  .max(MAX_CUSTOM_DIRECTIVES_LENGTH, "Custom directives are limited to 16KB.")
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .refine((value) => !hasForbiddenControlChar(value), {
    message: "Custom directives cannot contain control characters.",
  })
  .refine((value) => caddyBraceBalance(value) === 0, {
    message:
      "Braces must balance within the block: directives cannot close the site block they live in.",
  });

export type CustomDirectives = z.infer<typeof customDirectivesSchema>;
