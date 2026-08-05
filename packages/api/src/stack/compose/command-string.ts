/**
 * Word-splitting for Compose's string-form `command:` / `entrypoint:`.
 *
 * The Compose spec says a string here is split into a list — the same shape as
 * the array form. It is NOT `/bin/sh -c <string>`; that is DOCKERFILE shell-form
 * semantics, and applying it here broke every image carrying its own
 * ENTRYPOINT, because the wrapper became the entrypoint's first argument.
 * Authentik (`command: server`, entrypoint `dumb-init -- ak`) ran
 * `ak /bin/sh -c server`, died on "Unknown command: '/bin/sh'", and
 * restart-looped. MinIO and Plausible were mis-assembled the same way.
 *
 * Its own module so the scanner can be split for readability without pushing
 * normalize.ts past the file-length cap.
 */

interface Scan {
  /** Characters consumed, including the closing quote. */
  consumed: number;
  value: string;
}

/** Read a quoted run starting AFTER the opening quote. Only double quotes
 *  process backslash escapes, matching POSIX shells. An unterminated quote
 *  runs to end-of-input rather than throwing — a compose file is not a shell,
 *  and failing the whole parse over a stray quote helps nobody. */
function scanQuoted(input: string, from: number, quote: '"' | "'"): Scan {
  let value = "";
  let i = from;
  for (; i < input.length; i++) {
    const ch = input[i] as string;
    if (ch === "\\" && quote === '"' && i + 1 < input.length) {
      value += input[++i];
      continue;
    }
    if (ch === quote) return { consumed: i - from + 1, value };
    value += ch;
  }
  return { consumed: i - from, value };
}

export function splitCommandString(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  // Tracked separately from `cur` so an intentionally empty argument (`--flag
  // ""`) survives: the token exists even though it has no characters.
  let started = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;

    if (ch === '"' || ch === "'") {
      const scan = scanQuoted(input, i + 1, ch);
      cur += scan.value;
      started = true;
      i += scan.consumed;
      continue;
    }
    if (ch === "\\" && i + 1 < input.length) {
      cur += input[++i];
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) out.push(cur);
      cur = "";
      started = false;
      continue;
    }
    cur += ch;
    started = true;
  }

  if (started) out.push(cur);
  return out;
}
