/**
 * Pure tokenizer + search model for the Caddyfile viewer. Lightweight,
 * dependency-free Caddyfile coloring (comments, directives, site
 * addresses, placeholders, numbers, strings) plus a per-segment search
 * splitter that tags hits with a global match index for navigation.
 */

export type TokenKind =
  | "comment"
  | "directive"
  | "site"
  | "placeholder"
  | "number"
  | "string"
  | "punct"
  | "plain";

export const KIND_CLASS: Record<TokenKind, string> = {
  comment: "text-muted-foreground/55 italic",
  directive: "text-sky-300/90",
  site: "text-emerald-300/85",
  placeholder: "text-orange-300/85",
  number: "text-orange-300/85",
  string: "text-emerald-300/85",
  punct: "text-muted-foreground/70",
  plain: "text-foreground/85",
};

interface Token {
  text: string;
  kind: TokenKind;
}

export interface Segment {
  text: string;
  kind: TokenKind;
  /** Global match index when this segment is a search hit; else undefined. */
  match?: number;
}

export interface ViewModel {
  lines: Segment[][];
  total: number;
}

// Quoted string | {placeholder} | brace | whitespace | bareword.
const TOKEN_RE = /("[^"]*")|(\{[^{}\s][^{}]*\})|([{}])|(\s+)|([^\s{}]+)/g;

function tokenize(line: string): Token[] {
  const hash = line.indexOf("#");
  if (hash >= 0) {
    return [...tokenizeCode(line.slice(0, hash)), { text: line.slice(hash), kind: "comment" }];
  }
  return tokenizeCode(line);
}

function tokenizeCode(code: string): Token[] {
  const tokens: Token[] = [];
  // A site-address line opens a block and names a host (has a dot/wildcard):
  // `example.com {` or `a.com, b.com {`. Used to color the leading host.
  const opensBlock = code.trimEnd().endsWith("{");
  let seenWord = false;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(code))) {
    const [text, str, placeholder, brace, ws] = m;
    if (str) {
      tokens.push({ text, kind: "string" });
    } else if (placeholder) {
      tokens.push({ text, kind: "placeholder" });
    } else if (brace) {
      tokens.push({ text, kind: "punct" });
    } else if (ws) {
      tokens.push({ text, kind: "plain" });
    } else {
      const isFirstWord = !seenWord;
      seenWord = true;
      tokens.push({ text, kind: classifyWord(text, isFirstWord, opensBlock) });
    }
  }
  return tokens;
}

function classifyWord(word: string, isFirstWord: boolean, opensBlock: boolean): TokenKind {
  if (isFirstWord) {
    // Leading host on a block-opening line ⇒ site address; otherwise it's
    // the directive name (reverse_proxy, tls, handle, forward_auth, …).
    if (opensBlock && /[.*]/.test(word)) return "site";
    return "directive";
  }
  if (/^:?\d+$/.test(word)) return "number";
  return "plain";
}

/** Tokenize every line and, when `query` is set, split tokens on each
 *  case-insensitive hit so matches can be highlighted and counted. Match
 *  indices are assigned in document order for prev/next navigation. */
export function buildModel(source: string, query: string): ViewModel {
  const q = query.toLowerCase();
  let counter = 0;
  const lines = source.split("\n").map((line) => {
    const tokens = tokenize(line);
    if (!q) return tokens as Segment[];
    const segs: Segment[] = [];
    for (const tok of tokens) {
      const lower = tok.text.toLowerCase();
      let i = 0;
      while (i < tok.text.length) {
        const idx = lower.indexOf(q, i);
        if (idx === -1) {
          segs.push({ text: tok.text.slice(i), kind: tok.kind });
          break;
        }
        if (idx > i) segs.push({ text: tok.text.slice(i, idx), kind: tok.kind });
        segs.push({
          text: tok.text.slice(idx, idx + query.length),
          kind: tok.kind,
          match: counter++,
        });
        i = idx + query.length;
      }
    }
    return segs;
  });
  return { lines, total: counter };
}
