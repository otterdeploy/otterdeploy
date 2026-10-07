import * as z from "zod";

import { lexDirectives } from "./caddyfile-lexer";
import { customDirectivesReachError } from "./custom-directives-reach";

/**
 * Raw per-route Caddyfile directives (od-f4rb, owner decision 2026-08-19).
 *
 * The text is spliced verbatim INSIDE the route's site block, so the schema
 * guards two things. Structure: a block must not be able to close the
 * enclosing site block and open a new one (which would let a route claim
 * other domains or redefine global options). Reach: a directive
 * must not reach the edge's own control surface: the admin API, loopback,
 * Unix sockets, imported files, or files outside /srv (see
 * ./custom-directives-reach). Whether the directives are valid Caddyfile is
 * decided by the real gate: the reconciler adapts the full generated config
 * through Caddy's own /adapt endpoint, re-checks reach on the adapted JSON,
 * and rolls the row back if either rejects it; node-push re-validates with
 * `caddy validate` before swapping the live file.
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
 * Final block depth as Caddy reads the text (see ./caddyfile-lexer): only a
 * bare, unquoted `{` / `}` token is structure, and `#` starts a comment only
 * at the start of a token. Returns -1 the moment depth dips below zero (an
 * escape from the enclosing site block).
 */
export function caddyBraceBalance(text: string): number {
  return lexDirectives(text).depth;
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
  })
  .superRefine((value, ctx) => {
    const reach = customDirectivesReachError(value);
    if (reach) ctx.addIssue({ code: "custom", message: reach });
  });

export type CustomDirectives = z.infer<typeof customDirectivesSchema>;
