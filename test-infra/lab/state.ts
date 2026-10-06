/**
 * Per-run local state, kept OUTSIDE the repo under the OS temp dir:
 *
 *   <tmp>/otterlab/<run>/          key pair, known_hosts, state.json (deleted by `down`)
 *   <tmp>/otterlab-evidence/<run>/ evidence for the report (kept after `down`)
 *
 * Hetzner resources do not depend on this file (labels are their state); it is
 * how `down` knows the exact DNS record ids it created.
 */
import { Result } from "better-result";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";

import { describeCause, LabError, type LabResult } from "./support";

export const LAB_TMP = join(tmpdir(), "otterlab");
export const EVIDENCE_TMP = join(tmpdir(), "otterlab-evidence");

const nodeStateSchema = z.object({
  name: z.string(),
  role: z.string(),
  serverId: z.number(),
  serverName: z.string(),
  serverType: z.string(),
  location: z.string(),
  ipv4: z.string(),
  ipv6: z.string().nullable(),
  privateIp: z.string().nullable(),
  createdAt: z.string(),
  fqdn: z.string().nullable(),
});
export type NodeState = z.infer<typeof nodeStateSchema>;

const runStateSchema = z.object({
  run: z.string(),
  topology: z.string(),
  expires: z.number(),
  createdAt: z.string(),
  hourlyGross: z.number(),
  hourlyNet: z.number(),
  nodes: z.array(nodeStateSchema),
  dnsRecords: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type RunState = z.infer<typeof runStateSchema>;

export function runDir(run: string): string {
  return join(LAB_TMP, run);
}

export function evidenceDir(run: string): string {
  const dir = join(EVIDENCE_TMP, run);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function keyPath(run: string): string {
  return join(runDir(run), "id_ed25519");
}

export function saveState(state: RunState): void {
  mkdirSync(runDir(state.run), { recursive: true, mode: 0o700 });
  writeFileSync(join(runDir(state.run), "state.json"), `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function loadState(run: string): LabResult<RunState | null> {
  const path = join(runDir(run), "state.json");
  const text = Result.try({
    try: () => readFileSync(path, "utf8"),
    catch: () => new LabError("state", "missing"),
  });
  if (text.isErr()) return Result.ok(null);
  const json = Result.try({
    try: (): unknown => JSON.parse(text.value),
    catch: (cause) => new LabError("state", `unreadable ${path}: ${describeCause(cause)}`),
  });
  if (json.isErr()) return Result.err(json.error);
  const parsed = runStateSchema.safeParse(json.value);
  return parsed.success
    ? Result.ok(parsed.data)
    : Result.err(new LabError("state", `invalid ${path}: ${parsed.error.message}`));
}

export function localRuns(): string[] {
  return Result.try(() => readdirSync(LAB_TMP)).unwrapOr([]);
}

/** Remove the run's key pair and state (never the evidence). */
export function removeRunDir(run: string): void {
  rmSync(runDir(run), { recursive: true, force: true });
}
