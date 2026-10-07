/**
 * A Caddyfile lexer for raw per-route directives, faithful to Caddy's own
 * (caddyconfig/caddyfile/lexer.go + parse.go) wherever reading it differently
 * would let text mean one thing to us and another to the edge:
 *
 *  - any Unicode space separates tokens; only `\n` ends a line, and a
 *    backslash before it (even inside a comment) continues the line instead;
 *  - `"…"` and `` `…` `` quote a token only at its start; inside `"…"` only
 *    `\"` is an escape, every other backslash stays literal;
 *  - `#` starts a comment only at the start of a token (`a#b` is one token);
 *  - only an UNQUOTED bare `{` / `}` token is structure: `{uri}`, `"}"` and
 *    `a{` are text.
 *
 * Heredocs are not modelled: their bodies are read as directives, which can
 * only make a check stricter, never looser.
 */

/** One logical directive line: its tokens, and the directive of every block it
 *  sits in (innermost last). */
export interface DirectiveLine {
  tokens: string[];
  parents: string[];
}

export interface LexedDirectives {
  lines: DirectiveLine[];
  /** Open blocks at the end, or -1 the moment a `}` closed a block the text
   *  never opened (an escape from the enclosing site block). */
  depth: number;
}

/** Go's unicode.IsSpace, which is what Caddy splits tokens on. */
const SPACE = /[\s\u0085]/;

/** Lexer state, one character at a time. */
class DirectiveLexer {
  readonly lines: DirectiveLine[] = [];
  private readonly stack: string[] = [];
  private underflow = false;
  private tokens: string[] = [];
  private token = "";
  private inToken = false;
  private quote: '"' | "`" | null = null;
  private comment = false;
  private escaped = false;

  get depth(): number {
    return this.underflow ? -1 : this.stack.length;
  }

  read(ch: string): void {
    if (this.quote !== null) this.readQuoted(ch, this.quote);
    else if (!this.escaped && ch === "\\") this.escaped = true;
    else if (SPACE.test(ch)) this.readSpace(ch);
    else this.readBare(ch);
  }

  finish(): void {
    if (this.quote !== null) this.pushToken(this.token, true);
    this.endToken();
    this.endLine(this.stack);
  }

  /** Inside "…" only \" escapes; `…` has no escapes at all. */
  private readQuoted(ch: string, quote: '"' | "`"): void {
    if (this.escaped && quote === '"') {
      this.token += ch === '"' ? ch : `\\${ch}`;
      this.escaped = false;
    } else if (quote === '"' && ch === "\\") {
      this.escaped = true;
    } else if (ch === quote) {
      this.quote = null;
      this.pushToken(this.token, true);
    } else {
      this.token += ch;
    }
  }

  /** Any space ends the token; an escaped newline continues the line. */
  private readSpace(ch: string): void {
    this.endToken();
    if (ch !== "\n") return;
    this.comment = false;
    if (this.escaped) this.escaped = false;
    else this.endLine(this.stack);
  }

  private readBare(ch: string): void {
    if (ch === "#" && !this.inToken) this.comment = true;
    if (this.comment) return;
    if (!this.inToken && (ch === '"' || ch === "`")) {
      this.quote = ch;
      this.inToken = true;
      return;
    }
    if (this.escaped) {
      // `\<` only defuses a heredoc opener; every other escape stays literal.
      if (ch !== "<") this.token += "\\";
      this.escaped = false;
    }
    this.token += ch;
    this.inToken = true;
  }

  private endToken(): void {
    if (this.inToken) this.pushToken(this.token, false);
  }

  private pushToken(value: string, quoted: boolean): void {
    this.token = "";
    this.inToken = false;
    if (!quoted && value === "{") {
      const parents = [...this.stack];
      this.stack.push(this.tokens[0] ?? "");
      this.endLine(parents);
    } else if (!quoted && value === "}") {
      this.endLine(this.stack);
      if (this.stack.length === 0) this.underflow = true;
      this.stack.pop();
    } else {
      this.tokens.push(value);
    }
  }

  private endLine(parents: string[]): void {
    if (this.tokens.length > 0) this.lines.push({ tokens: this.tokens, parents: [...parents] });
    this.tokens = [];
  }
}

export function lexDirectives(text: string): LexedDirectives {
  const lexer = new DirectiveLexer();
  for (const ch of text) lexer.read(ch);
  lexer.finish();
  return { lines: lexer.lines, depth: lexer.depth };
}
