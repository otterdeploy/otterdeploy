/**
 * Pre/post-deploy lifecycle hooks.
 *
 * Each hook command runs in its own throwaway `docker run --rm` container off
 * the freshly-built image, joined to the project network and carrying the same
 * resolved env the service runs with, so a migration reaches the database by
 * its alias exactly as the app would.
 *
 *   - A stored hook is EXEC FORM: one command's argv, `--entrypoint argv[0]`
 *     and the rest as arguments, so it runs regardless of the image's own
 *     ENTRYPOINT. The manifest's string shorthand is stored as `sh -c <line>`.
 *     An array saved by the old settings editor (whole shell lines, argv[0]
 *     containing whitespace) still runs one `sh -c` per line. See
 *     @otterdeploy/shared/deploy-hook for the one place that reads a hook.
 *   - env is passed via `--env-file`, never `-e KEY=VAL`, so secret values
 *     don't land on the command line the LogSink echoes. Values are also
 *     registered as `secrets` for masking, belt-and-braces.
 *   - commands run in order; the first non-zero exit stops the batch and
 *     yields a `DeployHookError` that carries the command's last output lines,
 *     so the failure explains itself wherever it is shown.
 *
 * Output streams line by line to the deployment log as it is produced, so
 * operators see migration output inline in the deployment log.
 */

import type { DeploymentId, ProjectId, ResourceId, PreviewId } from "@otterdeploy/shared/id";

import { resolveDeployHookContext } from "@otterdeploy/api/routers/service/deploy-hook";
import { hookInvocations } from "@otterdeploy/shared/deploy-hook";
import { Result } from "better-result";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LogSink } from "./log-stream";

import { DeployHookError } from "./errors";
import { runProcess } from "./run-process";

export type HookPhase = "pre-deploy" | "post-deploy";

/** How much of a failed hook's output its error carries: enough to read the
 *  actual failure (a migration's stack trace ends there), short enough for a
 *  deployment's error message. */
const FAILURE_TAIL_LINES = 20;
/** ...and never more than this many characters of it (long trace lines). */
const FAILURE_TAIL_MAX_CHARS = 2_000;

interface RunHooksOpts {
  /** Preview scoping, forwarded into env resolution so hook refs hit the
   *  preview's DB branch (when opted in), never production. */
  previewId?: PreviewId | null;
  phase: HookPhase;
  /** The stored hook (see @otterdeploy/shared/deploy-hook for its forms). */
  commands: string[];
  /** The freshly-built image tag the hook container runs off. */
  image: string;
  projectId: ProjectId;
  resourceId: ResourceId;
  projectSlug: string;
  deploymentId: DeploymentId;
  sink: LogSink;
}

/** Below this, a value cannot hold a secret worth hiding, and masking it
 *  scrambles the hook's output: `DJANGO_LOAD_INITIAL_DATA=on` turned a
 *  migration error into "django.c***trib.postgres must be in INSTALLED_APPS".
 *  Same floor as the build's masking (build-env.ts). */
const MIN_MASKED_LENGTH = 6;

/**
 * The env values masked out of a hook's output and its failure message. Every
 * value, not just the secret-flagged ones: a migration error echoes connection
 * strings and keys whatever their flag says. Only too-short values are spared.
 */
export function hookMaskedValues(env: Record<string, string>): string[] {
  return Object.values(env).filter((value) => value.length >= MIN_MASKED_LENGTH);
}

const msg = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export async function runDeployHooks(opts: RunHooksOpts): Promise<Result<void, DeployHookError>> {
  const { phase, sink } = opts;
  const invocations = hookInvocations(opts.commands);
  if (invocations.length === 0) return Result.ok(undefined);

  // Same env + network the service itself gets, so refs (e.g. a DB url) resolve.
  const ctx = await resolveDeployHookContext(
    opts.projectId,
    opts.resourceId,
    opts.projectSlug,
    opts.previewId ?? null,
  );
  if (ctx.isErr()) {
    return Result.err(
      new DeployHookError({ phase, reason: `env resolution failed: ${ctx.error.message}` }),
    );
  }
  const { env, networkName } = ctx.value;
  const secrets = hookMaskedValues(env);

  // Stage env to a temp file (off the logged argv). Result-wrapped, no raw
  // try/catch in this Result-returning flow.
  const staged = await Result.tryPromise({
    try: async () => {
      const dir = await mkdtemp(join(tmpdir(), `otterhook-${opts.deploymentId}-`));
      const envFile = join(dir, "env");
      await writeFile(envFile, formatEnvFile(env), { mode: 0o600 });
      return { dir, envFile };
    },
    catch: (cause): DeployHookError =>
      new DeployHookError({ phase, reason: `env staging failed: ${msg(cause)}` }),
  });
  if (staged.isErr()) return Result.err(staged.error);

  sink.system(`${phase}: running ${invocations.length} command(s) on ${networkName}`);
  const outcome = await runHookCommands({
    phase,
    invocations,
    image: opts.image,
    deploymentId: opts.deploymentId,
    envFile: staged.value.envFile,
    networkName,
    secrets,
    sink,
  });

  // Always clean the staged env file, success or failure.
  await rm(staged.value.dir, { recursive: true, force: true }).catch(() => undefined);
  return outcome;
}

/**
 * `docker run` arguments for one hook command: argv[0] becomes the entrypoint
 * (so the image's own ENTRYPOINT never wraps it) and the rest its arguments.
 */
export function hookRunArgs(input: {
  phase: HookPhase;
  deploymentId: DeploymentId;
  index: number;
  networkName: string;
  envFile: string;
  image: string;
  argv: readonly [string, ...string[]];
}): string[] {
  const [program, ...rest] = input.argv;
  return [
    "run",
    "--rm",
    "--name",
    `otterhook-${input.phase}-${input.deploymentId}-${input.index}`,
    "--network",
    input.networkName,
    "--env-file",
    input.envFile,
    "--entrypoint",
    program,
    "--label",
    `otterdeploy.hook=${input.phase}`,
    "--label",
    `otterdeploy.deployment.id=${input.deploymentId}`,
    input.image,
    ...rest,
  ];
}

/** An argv as the operator would type it, for the log and the error. */
function displayCommand(argv: readonly string[]): string {
  return argv.map((a) => (/\s/.test(a) || a === "" ? JSON.stringify(a) : a)).join(" ");
}

/** The end of a failed command's output: its last non-empty lines, capped. */
function failureTail(tail: string): string {
  return tail
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(-FAILURE_TAIL_LINES)
    .join("\n")
    .slice(-FAILURE_TAIL_MAX_CHARS);
}

/** Run a hook's commands in order; the first failure stops the batch. */
export async function runHookCommands(args: {
  phase: HookPhase;
  invocations: string[][];
  image: string;
  deploymentId: DeploymentId;
  envFile: string;
  networkName: string;
  secrets: string[];
  sink: LogSink;
}): Promise<Result<void, DeployHookError>> {
  const total = args.invocations.length;
  for (const [i, argv] of args.invocations.entries()) {
    const [program, ...rest] = argv;
    if (program === undefined) continue;
    const shown = displayCommand(argv);
    args.sink.system(`${args.phase} [${i + 1}/${total}]: ${shown}`);

    const ran = await Result.tryPromise({
      try: () =>
        runProcess({
          cmd: "docker",
          args: hookRunArgs({
            phase: args.phase,
            deploymentId: args.deploymentId,
            index: i,
            networkName: args.networkName,
            envFile: args.envFile,
            image: args.image,
            argv: [program, ...rest],
          }),
          sink: args.sink,
          secrets: args.secrets,
        }),
      catch: (cause): DeployHookError =>
        new DeployHookError({
          phase: args.phase,
          reason: `failed to launch hook container: ${msg(cause)}`,
        }),
    });
    if (ran.isErr()) return Result.err(ran.error);
    if (ran.value.exitCode !== 0) {
      const output = failureTail(ran.value.tail);
      return Result.err(
        new DeployHookError({
          phase: args.phase,
          reason: `command exited ${ran.value.exitCode}: ${shown}${output ? `\n${output}` : ""}`,
        }),
      );
    }
    args.sink.system(`${args.phase} [${i + 1}/${total}]: done`);
  }
  return Result.ok(undefined);
}

/** docker `--env-file` format: bare `KEY=VAL` lines, value taken verbatim to
 *  end of line (no quoting). Entries whose key or value contains a newline
 *  can't be represented, so drop them rather than corrupt the file. */
function formatEnvFile(env: Record<string, string>): string {
  return Object.entries(env)
    .filter(([k, v]) => !k.includes("\n") && !v.includes("\n"))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}
