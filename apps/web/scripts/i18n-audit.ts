/**
 * i18n audit — finds user-visible English strings that are not routed through
 * `t()`.
 *
 * This is a lint, not a codemod: it reports, it never rewrites. Run it before
 * shipping a surface so a hardcoded label can't quietly land in a screen that
 * is otherwise translated.
 *
 * It answers a different question from the type system. Once a string is
 * routed through `t()`, `packages/i18n/src/types.ts` takes over: the key must
 * exist and every locale must define it, both enforced by `tsc`. What types
 * cannot see is a string that never entered the system at all — a bare
 * `<span>Deploy failed</span>` typechecks perfectly. That gap is this
 * script's entire job.
 *
 *   bun apps/web/scripts/i18n-audit.ts            # summary by feature area
 *   bun apps/web/scripts/i18n-audit.ts --list     # every finding, file:line
 *   bun apps/web/scripts/i18n-audit.ts --dir features/backups
 *
 * What counts as user-visible (the heuristics that matter):
 *   - JSX text nodes            <p>Deploy failed</p>
 *   - Copy-bearing attributes   title= description= placeholder= label=
 *                               aria-label= emptyText= tooltip=
 *   - Toast / dialog copy       toast.success("…")  toast.error("…")
 *
 * What is deliberately NOT flagged (machine-readable or non-copy):
 *   - Anything already inside t(…) or a Trans element
 *   - className / data-* / href / to / id / key / type / value / variant …
 *   - Strings with no letters, single words that are lowercase identifiers,
 *     mono/technical tokens (env keys, paths, image refs, HTTP verbs)
 *   - Test and story files, generated route tree
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

/** Attributes whose string value is shown to a person. */
const COPY_ATTRS = new Set([
  "title",
  "description",
  "placeholder",
  "label",
  "aria-label",
  "aria-description",
  "emptyText",
  "tooltip",
  "heading",
  "subtitle",
  "message",
  "confirmText",
  "cancelText",
  "submitText",
  "helpText",
  "hint",
]);

/** Files that never render product copy. */
function isSkippedFile(path: string): boolean {
  return (
    path.endsWith(".test.ts") ||
    path.endsWith(".test.tsx") ||
    path.endsWith(".stories.tsx") ||
    path.endsWith("route-tree.gen.ts") ||
    path.includes("/__tests__/") ||
    // Brand logo components: every <title> is a product name (Postgres,
    // Cloudflare, Next.js). Proper nouns are the same in every locale, and
    // translating them would be wrong, not merely unnecessary.
    path.includes("/components/ui/svgs/") ||
    path.includes("/brand/")
  );
}

/**
 * A literal is technical (not copy) when it reads as something a machine
 * consumes rather than something a person reads.
 */
function isTechnical(value: string): boolean {
  const text = value.trim();
  if (text.length < 2) return true;
  if (!/[a-zA-Z]/.test(text)) return true;
  // Single lowercase token — almost always an identifier, slug, or enum value.
  if (/^[a-z][a-z0-9_-]*$/.test(text)) return true;
  // camelCase / PascalCase single token, kebab or snake identifiers.
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(text) && !/\s/.test(text) && text.length < 4) return true;
  // TypeScript and JSX syntax the text regex can catch between angle brackets
  // — `ComponentProps<"div"> & VariantProps<…>`, `{cond && <X/>}`.
  if (/&&|\|\||=>|\?\.|===|!==|^&\s|\s&$/.test(text)) return true;
  if (/^&\s*\w+/.test(text)) return true;
  // Prose has either a space or an initial capital; a bare lowercase token is
  // an identifier.
  if (!/\s/.test(text) && !/^[A-Z]/.test(text)) return true;
  // Paths, URLs, env keys, image refs, mime types, selectors, template exprs.
  if (/^[/.#$@]/.test(text)) return true;
  if (/^https?:\/\//.test(text)) return true;
  if (/^[A-Z][A-Z0-9_]*$/.test(text)) return true;
  if (/^\w+\/\w+/.test(text)) return true;
  if (/^\{\{.*\}\}$/.test(text)) return true;
  // Type-expression fragments the `>…<` scan picks up inside generics:
  // `Omit<Props, "x">`, `): React.RefObject<T>`, `void | Promise<void>`.
  if (/\bextends\b|\bPromise\b|\bReact\.|\bnew (Set|Map)\b|\bvoid\b/.test(text)) return true;
  if (/[()[\]|]/.test(text)) return true;
  if (/^,|^:|^=/.test(text)) return true;
  // Machine-readable strings the Two-Cuts Rule keeps in mono and therefore
  // untranslated: shell commands, env assignments, HTTP header names, key
  // material. Translating any of these would make them wrong, not localised.
  if (/^(docker|npm|bun|pnpm|yarn|git|ssh|scp|curl|sudo|systemctl|otterdeploy)\s/.test(text)) {
    return true;
  }
  if (/^[A-Z][A-Z0-9_]*=/.test(text)) return true;
  if (/^(X-|Authorization\b|Content-Type\b)/.test(text)) return true;
  if (/^(ssh-(rsa|ed25519|dss)|ecdsa-sha2)\b/.test(text)) return true;
  return false;
}

interface Finding {
  file: string;
  line: number;
  kind: "jsx-text" | "attribute" | "toast";
  attr?: string;
  text: string;
}

/** Strip the regions the audit must not look inside. */
function maskIgnoredRegions(source: string): string {
  return (
    source
      // Whole-line comments and block comments.
      .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
      .replace(/(^|\n)\s*\/\/[^\n]*/g, (m) => " ".repeat(m.length))
      // Imports — module specifiers are never copy.
      .replace(/^import[^;]+;/gm, (m) => " ".repeat(m.length))
      // Anything already translated: t("…"), t('…'), i18nKey="…".
      .replace(/\bt\(\s*(["'`])[^"'`]*\1/g, (m) => " ".repeat(m.length))
      .replace(/i18nKey\s*=\s*(["'])[^"']*\1/g, (m) => " ".repeat(m.length))
      // Tailwind and other non-copy attributes.
      .replace(
        /\b(className|class|data-[\w-]+|href|to|id|key|type|value|variant|size|name|role|src|as|from|path|icon|color|fill|stroke|viewBox|d|xmlns|charSet|rel|target|method|accept|autoComplete|storageKey|queryKey|slug|field|mode|side|align|position|direction|orientation|layout|format|locale|currency|timeZone|pattern|inputMode|enterKeyHint|testId)\s*=\s*(["'])[^"']*\2/g,
        (m) => " ".repeat(m.length),
      )
  );
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === "\n") line++;
  return line;
}

function auditFile(path: string): Finding[] {
  const raw = readFileSync(path, "utf8");
  const masked = maskIgnoredRegions(raw);
  const findings: Finding[] = [];
  const rel = relative(join(import.meta.dir, "..", ".."), path);

  // 1. Copy-bearing attributes with a plain string literal. Only in .tsx —
  // in a .ts file an `aria-label="…"` is inside a CSS selector string (the
  // tour's step list), not a JSX attribute.
  const attrRe = /\b([a-zA-Z-]+)\s*=\s*(["'])([^"'\n]{2,})\2/g;
  const scanAttrs = path.endsWith(".tsx");
  for (const match of scanAttrs ? masked.matchAll(attrRe) : []) {
    const [, attr, , text] = match;
    if (!COPY_ATTRS.has(attr)) continue;
    if (isTechnical(text)) continue;
    findings.push({
      file: rel,
      line: lineOf(masked, match.index),
      kind: "attribute",
      attr,
      text,
    });
  }

  // 2. Toast and dialog copy passed as a bare literal.
  const toastRe = /\btoast(?:\.(?:success|error|warning|info|loading))?\(\s*(["'])([^"'\n]{2,})\1/g;
  for (const match of masked.matchAll(toastRe)) {
    const text = match[2];
    if (isTechnical(text)) continue;
    findings.push({ file: rel, line: lineOf(masked, match.index), kind: "toast", text });
  }

  // 3. JSX text nodes — text sitting directly between tags. Only in .tsx:
  // in a .ts file every `>…<` is a generic, never markup.
  if (!path.endsWith(".tsx")) return findings;
  const textRe = />([^<>{}\n]{2,})</g;
  for (const match of masked.matchAll(textRe)) {
    const text = match[1].trim();
    if (text.length < 2) continue;
    if (isTechnical(text)) continue;
    // Punctuation-only separators and single symbols.
    if (!/[a-zA-Z]{2,}/.test(text)) continue;
    findings.push({ file: rel, line: lineOf(masked, match.index), kind: "jsx-text", text });
  }

  return findings;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !isSkippedFile(full)) {
      out.push(full);
    }
  }
  return out;
}

// ─── Report ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const listMode = args.includes("--list");
const dirArg = args.indexOf("--dir");
const root = dirArg >= 0 && args[dirArg + 1] ? join(SRC, args[dirArg + 1]) : SRC;

const files = walk(root);
const all = files.flatMap(auditFile);

if (listMode) {
  for (const f of all) {
    const where = f.attr ? `${f.kind}:${f.attr}` : f.kind;
    console.log(`${f.file}:${f.line}  [${where}]  ${f.text}`);
  }
}

// Group by feature area (features/x, shared, routes).
const byArea = new Map<string, number>();
for (const f of all) {
  const parts = f.file.split("/");
  const idx = parts.indexOf("src");
  const area =
    parts[idx + 1] === "features" ? `features/${parts[idx + 2]}` : (parts[idx + 1] ?? "other");
  byArea.set(area, (byArea.get(area) ?? 0) + 1);
}

const areas = [...byArea.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\n  Untranslated strings by area (${all.length} total, ${files.length} files)\n`);
for (const [area, count] of areas) {
  console.log(`  ${String(count).padStart(5)}  ${area}`);
}
console.log("");

// Non-zero exit so this can gate CI once an area reaches zero.
process.exit(all.length > 0 ? 1 : 0);
