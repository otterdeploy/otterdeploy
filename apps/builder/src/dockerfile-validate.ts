/**
 * Fail-fast Dockerfile validation. A cheap static pass BEFORE `docker buildx`
 * runs, so unsupported instructions produce a clear `file:line + reason + fix`
 * instead of a silent-wrong build.
 *
 * `VOLUME` used to be a hard error here, copied from Railway (which rejects it
 * in ~4s with the line number). That refused many widely used open-source apps
 * (gitea, navidrome, vaultwarden, memos, plausible, ...) and the suggested
 * `volume add` did not lift it, so the only way through was forking the repo.
 * The danger it guarded against is real: an anonymous volume is not carried to
 * the next deploy's container, so data written there disappears. The fix is to
 * keep the data, not to refuse the app: after the build the pipeline backs
 * every path the IMAGE declares as a VOLUME with a persistent named volume for
 * the service, or with the volume the operator already attached there (see
 * ./image-volumes.ts). This pass only warns, so the build log says what will
 * happen before it does.
 *
 * This is a light instruction-level parser, not a full Dockerfile grammar: it
 * joins line continuations, skips comments and heredoc bodies, and reports the
 * keyword + start line of each logical instruction. That's enough to flag the
 * instructions worth calling out without false-positiving on `VOLUME` appearing
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
    // instructions): skip.
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
    // terminator) are content, not instructions. Skip them.
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
 * Where the image is going, which decides what happens to its VOLUME paths:
 * a plain service gets them backed by persistent volumes after the build; a
 * compose stack's mounts are whatever its compose file declares.
 */
export type DockerfileTarget = "service" | "compose";

const VOLUME_FIX: Record<DockerfileTarget, string> = {
  service:
    "After the build, each VOLUME path the image declares is backed by a persistent volume for this service (or by the volume already attached at that path), so its data survives redeploys. Manage them with `otterdeploy volume`.",
  compose:
    "A compose stack keeps only the volumes its compose file declares: mount a named volume at this path in the compose file (`volumes: [name:<path>]`) to keep its data across deploys.",
};

/**
 * Validate a Dockerfile's text. Returns hard `errors` (the build must not
 * proceed) and non-fatal `warnings`. Pure, no filesystem or docker access.
 */
export function validateDockerfile(
  content: string,
  target: DockerfileTarget = "service",
): {
  errors: DockerfileIssue[];
  warnings: DockerfileIssue[];
} {
  const errors: DockerfileIssue[] = [];
  const warnings: DockerfileIssue[] = [];

  for (const instr of parseInstructions(content)) {
    if (instr.keyword === "VOLUME") {
      warnings.push({
        line: instr.line,
        instruction: "VOLUME",
        message: `VOLUME at line ${instr.line} (${instr.args}) declares an anonymous volume, which docker would not carry to the next deploy.`,
        fix: VOLUME_FIX[target],
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
export function assertDockerfileValid(
  content: string,
  warn: (message: string) => void,
  target: DockerfileTarget = "service",
): void {
  const { errors, warnings } = validateDockerfile(content, target);
  for (const w of warnings) warn(`dockerfile warning: ${w.message} ${w.fix}`);
  const [firstError] = errors;
  if (firstError) throw new Error(formatDockerfileError(firstError));
}
