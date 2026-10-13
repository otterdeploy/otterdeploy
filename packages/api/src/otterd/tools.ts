/**
 * The control plane's side doors to the off-node anchor and to fence
 * providers, both through the `otterd-recover` binary so there is one
 * implementation of the anchor's compare-and-swap protocol and of each fence
 * adapter. Credentials reach the child through its environment only, never
 * its arguments; inputs go through 0600 temporary files.
 */
import { fenceEvidence, type FenceEvidence, type MachineBinding } from "@otterdeploy/otterd-cp";
import { Result, TaggedError } from "better-result";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";

export class ToolError extends TaggedError("ToolError")<{ message: string; tool: string }>() {}

export interface ToolConfig {
  /** Path of the `otterd-recover` binary. */
  binary: string;
  /** Anchor location file (`otterd-recover anchor --config`), when an anchor is configured. */
  anchorConfig?: string;
  /** The anchor enrollment key file (base64 seed, 0600). */
  enrollmentKey?: string;
  /** Environment for the child: anchor store credentials, provider tokens. */
  env: Record<string, string>;
}

async function invoke(
  cfg: ToolConfig,
  args: string[],
  files: Record<string, unknown>,
): Promise<Result<unknown, ToolError>> {
  const dir = mkdtempSync(join(tmpdir(), "otterd-cp-"));
  const paths: Record<string, string> = {};
  for (const [name, value] of Object.entries(files)) {
    const p = join(dir, `${name}.json`);
    writeFileSync(p, JSON.stringify(value), { mode: 0o600 });
    paths[name] = p;
  }
  const argv = args.map((a) => (a.startsWith("@") ? (paths[a.slice(1)] ?? a) : a));
  try {
    return await Result.tryPromise({
      catch: (e) => new ToolError({ message: String(e), tool: argv.slice(0, 2).join(" ") }),
      try: async () => {
        const child = Bun.spawn([cfg.binary, ...argv], {
          env: cfg.env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        if (code !== 0) throw new Error(err.trim() || `exit ${code}`);
        const parsed: unknown = JSON.parse(out);
        return parsed;
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const enrollOutcome = z.discriminatedUnion("result", [
  z.object({ result: z.literal("committed"), seq: z.number().int() }),
  z.object({
    result: z.literal("pending-frozen"),
    seq: z.number().int(),
    phase: z.string(),
    term: z.number().int(),
  }),
]);
export type EnrollOutcome = z.infer<typeof enrollOutcome>;

const anchorStatus = z.object({
  term: z.object({
    installId: z.string(),
    recoveryTerm: z.number().int(),
    phase: z.enum(["active", "recovery-pending"]),
  }),
});
export type AnchorStatus = z.infer<typeof anchorStatus>["term"];

function parsed<T>(
  r: Result<unknown, ToolError>,
  schema: z.ZodType<T>,
  tool: string,
): Result<T, ToolError> {
  if (r.isErr()) return Result.err(r.error);
  const p = schema.safeParse(r.value);
  return p.success
    ? Result.ok(p.data)
    : Result.err(new ToolError({ message: p.error.message, tool }));
}

export interface NodeRecord {
  nodeId: string;
  nodeEpoch: number;
  identityKeyId: string;
  host: Record<string, unknown>;
}

/** Append-before-capability: commit the node's record in the anchor head. */
export async function anchorEnroll(
  cfg: ToolConfig,
  node: NodeRecord,
): Promise<Result<EnrollOutcome, ToolError>> {
  if (!cfg.anchorConfig || !cfg.enrollmentKey) {
    return Result.err(new ToolError({ message: "no anchor configured", tool: "anchor enroll" }));
  }
  const r = await invoke(
    cfg,
    [
      "anchor",
      "--config",
      cfg.anchorConfig,
      "enroll",
      "--enrollment-key",
      cfg.enrollmentKey,
      "--node",
      "@node",
    ],
    { node },
  );
  return parsed(r, enrollOutcome, "anchor enroll");
}

/** The anchor's verified term and phase: issuance is allowed only while active at our term. */
export async function anchorTerm(cfg: ToolConfig): Promise<Result<AnchorStatus, ToolError>> {
  if (!cfg.anchorConfig)
    return Result.err(new ToolError({ message: "no anchor configured", tool: "anchor status" }));
  const r = await invoke(cfg, ["anchor", "--config", cfg.anchorConfig, "status"], {});
  return parsed(r, anchorStatus, "anchor status").map((s) => s.term);
}

/** Hard power-off through the provider, verified off; evidence or an error, never a guess. */
export async function fenceHetzner(
  cfg: ToolConfig,
  binding: MachineBinding,
): Promise<Result<FenceEvidence, ToolError>> {
  const r = await invoke(cfg, ["fence", "hetzner", "--binding", "@binding", "fence"], { binding });
  return parsed(r, fenceEvidence, "fence hetzner");
}
