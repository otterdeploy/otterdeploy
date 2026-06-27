/**
 * Pre/post-deploy lifecycle hooks.
 *
 * Each hook command runs in its own throwaway `docker run --rm` container off
 * the freshly-built image, joined to the project network and carrying the same
 * resolved env the service runs with — so a migration reaches the database by
 * its alias exactly as the app would.
 *
 *   - `--entrypoint sh … -c <command>` so the command runs regardless of the
 *     image's own ENTRYPOINT. (The image must ship a `sh`; app images do.)
 *   - env is passed via `--env-file`, never `-e KEY=VAL`, so secret values
 *     don't land on the command line the LogSink echoes. Values are also
 *     registered as `secrets` for masking, belt-and-braces.
 *   - commands run in order; the first non-zero exit stops the batch and
 *     yields a `DeployHookError`. Each command is an independent container —
 *     chain with `&&` inside one entry if you need shared shell state.
 *
 * Output streams to the same deployment-log sink as the build, so operators
 * see migration output inline in the deployment log.
 */

import type { DeploymentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { resolveDeployHookContext } from "@otterdeploy/api/routers/service/deploy-hook";
import { Result } from "better-result";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LogSink } from "./log-stream";

import { DeployHookError } from "./errors";
import { runProcess } from "./run-process";

export type HookPhase = "pre-deploy" | "post-deploy";

interface RunHooksOpts {
  phase: HookPhase;
  commands: string[];
  /** The freshly-built image tag the hook container runs off. */
  image: string;
  projectId: ProjectId;
  resourceId: ResourceId;
  projectSlug: string;
  deploymentId: DeploymentId;
  sink: LogSink;
}

const msg = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export async function runDeployHooks(opts: RunHooksOpts): Promise<Result<void, DeployHookError>> {
  const { phase, commands, sink } = opts;
  if (commands.length === 0) return Result.ok(undefined);

  // Same env + network the service itself gets, so refs (e.g. a DB url) resolve.
  const ctx = await resolveDeployHookContext(opts.projectId, opts.resourceId, opts.projectSlug);
  if (ctx.isErr()) {
    return Result.err(
      new DeployHookError({ phase, reason: `env resolution failed: ${ctx.error.message}` }),
    );
  }
  const { env, networkName } = ctx.value;
  const secrets: string[] = Object.values(env).filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );

  // Stage env to a temp file (off the logged argv). Result-wrapped — no raw
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

  sink.system(`${phase}: running ${commands.length} hook(s) on ${networkName}`);
  const outcome = await runHookCommands({
    phase,
    commands,
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

async function runHookCommands(args: {
  phase: HookPhase;
  commands: string[];
  image: string;
  deploymentId: DeploymentId;
  envFile: string;
  networkName: string;
  secrets: string[];
  sink: LogSink;
}): Promise<Result<void, DeployHookError>> {
  for (let i = 0; i < args.commands.length; i++) {
    const command = args.commands[i] ?? "";
    args.sink.system(`${args.phase} [${i + 1}/${args.commands.length}]: ${command}`);

    const ran = await Result.tryPromise({
      try: () =>
        runProcess({
          cmd: "docker",
          args: [
            "run",
            "--rm",
            "--name",
            `otterhook-${args.phase}-${args.deploymentId}-${i}`,
            "--network",
            args.networkName,
            "--env-file",
            args.envFile,
            "--entrypoint",
            "sh",
            "--label",
            `otterdeploy.hook=${args.phase}`,
            "--label",
            `otterdeploy.deployment.id=${args.deploymentId}`,
            args.image,
            "-c",
            command,
          ],
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
      return Result.err(
        new DeployHookError({
          phase: args.phase,
          reason: `command exited ${ran.value.exitCode}: ${command}`,
        }),
      );
    }
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
