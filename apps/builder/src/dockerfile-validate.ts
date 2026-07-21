/**
 * Fail-fast Dockerfile validation — a cheap static pass BEFORE `docker buildx`
 * runs, so unsupported instructions produce a clear `file:line + reason + fix`
 * instead of a silent-wrong build. Railway does exactly this (it rejects
 * `VOLUME` in ~4s with the line number); otterdeploy previously accepted the
 * same `VOLUME` and built an image whose anonymous volume isn't persisted across
 * deploys — worse than a hard error, because the data loss is invisible until it
 * happens.
 *
 * This is a light instruction-level parser, not a full Dockerfile grammar: it
 * joins line continuations, skips comments and heredoc bodies, and reports the
 * keyword + start line of each logical instruction. That's enough to flag the
 * instructions we don't support without false-positiving on `VOLUME` appearing
 * inside a RUN heredoc or a comment.
 */

/** One logical Dockerfile instruction: its keyword and 1-based start line. */
export interface DockerfileInstruction {
  line: number;
  keyword: string;
  args: string;
}

/** A validation problem tied to a specific line, with a concrete fix. */
export interface DockerfileIssue {
  line: number;
  instruction: string;
  message: string;
  fix: string;
}

const HEREDOC = /<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/;

/**
 * Split a Dockerfile into logical instructions. Handles `\` line continuations,
 * `#` comment lines, blank lines, and `<<EOF` heredocs (whose body lines are NOT
 * instructions). Line numbers are 1-based and point at where the instruction
 * begins.
 */
export function parseInstructions(content: string): DockerfileInstruction[] {
  const lines = content.split(/\r?\n/);
  const instructions: DockerfileInstruction[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    // Blank line or comment (parser directives also start with # and are not
    // instructions) — skip.
    if (trimmed === "" || trimmed.startsWith("#")) {
      i += 1;
      continue;
    }

    const startLine = i + 1;
    // Join continuation lines (trailing backslash) into one logical instruction.
    let joined = raw;
    while (joined.trimEnd().endsWith("\\") && i + 1 < lines.length) {
      joined = `${joined.trimEnd().slice(0, -1)} ${lines[i + 1] ?? ""}`;
      i += 1;
    }

    const match = /^\s*(\S+)\s*(.*)$/.exec(joined);
    if (match) {
      instructions.push({
        line: startLine,
        keyword: (match[1] ?? "").toUpperCase(),
        args: (match[2] ?? "").trim(),
      });
    }

    // If this instruction opened a heredoc, its body lines (up to the
    // terminator) are content, not instructions — skip them.
    const heredoc = HEREDOC.exec(joined);
    if (heredoc) {
      const terminator = heredoc[2];
      i += 1;
      while (i < lines.length && (lines[i] ?? "").trim() !== terminator) i += 1;
    }

    i += 1;
  }

  return instructions;
}

/**
 * Validate a Dockerfile's text. Returns hard `errors` (the build must not
 * proceed) and non-fatal `warnings`. Pure — no filesystem or docker access.
 */
export function validateDockerfile(content: string): {
  errors: DockerfileIssue[];
  warnings: DockerfileIssue[];
} {
  const errors: DockerfileIssue[] = [];
  const warnings: DockerfileIssue[] = [];

  for (const instr of parseInstructions(content)) {
    if (instr.keyword === "VOLUME") {
      errors.push({
        line: instr.line,
        instruction: "VOLUME",
        message: `VOLUME at line ${instr.line} is not supported — it creates an anonymous volume that is not persisted across deploys (data written there is lost on the next build).`,
        fix: "Remove the VOLUME line and attach a persistent volume instead: `otterdeploy volume add --service <name> --mount-path <path>`.",
      });
    }
  }

  return { errors, warnings };
}

/** Format the first error as a single Railway-style line. */
export function formatDockerfileError(issue: DockerfileIssue): string {
  return `dockerfile invalid: ${issue.message} ${issue.fix}`;
}

/**
 * Validate Dockerfile `content`, forwarding warnings to `warn` and THROWING on
 * the first hard error (so a build step's wrapper tags it and fails fast). The
 * thin side-effecting wrapper over the pure `validateDockerfile`, shared by both
 * builder entry points.
 */
export function assertDockerfileValid(content: string, warn: (message: string) => void): void {
  const { errors, warnings } = validateDockerfile(content);
  for (const w of warnings) warn(`dockerfile warning: ${w.message} ${w.fix}`);
  const [firstError] = errors;
  if (firstError) throw new Error(formatDockerfileError(firstError));
}
