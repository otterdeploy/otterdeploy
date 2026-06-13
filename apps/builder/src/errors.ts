/**
 * Tagged errors for the build pipeline. Each fallible step yields one of
 * these in the `Result.gen` flow (see `pipeline.ts`) instead of throwing a
 * bare `Error`, so failures stay typed and attributable — the deployment row
 * is marked failed off the error's `message`, and `_tag` lets callers branch.
 *
 * `PipelineLoadError` (the load-step error) lives in `load.ts` alongside the
 * loader that throws it.
 */

import type { DeploymentId } from "@otterdeploy/shared/id";

import { TaggedError } from "better-result";

/** A build step that shells out (clone, railpack, docker) or hits the DB
 *  threw. Wraps the cause with the step label so the failure stays
 *  attributable without a raw `throw new Error`. */
export class BuildStepError extends TaggedError("BuildStepError")<{
  step: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { step: string; cause: unknown }) {
    const detail =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      step: args.step,
      cause: args.cause,
      message: `build step "${args.step}" failed: ${detail}`,
    });
  }
}

/** The deployment row carries no gitSha / gitRef — it isn't a git-triggered
 *  build, so there's nothing to check out. */
export class InvalidDeploymentError extends TaggedError("InvalidDeploymentError")<{
  deploymentId: DeploymentId;
  message: string;
}>() {
  constructor(deploymentId: DeploymentId) {
    super({
      deploymentId,
      message: "deployment has no gitSha / gitRef — not a git-triggered build",
    });
  }
}

/** `redeployOne` returned an error — the swarm spec couldn't be re-applied. */
export class SwarmUpdateError extends TaggedError("SwarmUpdateError")<{
  message: string;
  cause: unknown;
}>() {
  constructor(cause: { message: string }) {
    super({ cause, message: `swarm update failed: ${cause.message}` });
  }
}

/** Swarm accepted the spec but the service never converged to healthy. */
export class SwarmConvergenceError extends TaggedError("SwarmConvergenceError")<{
  serviceName: string;
  health: string | null;
  message: string;
}>() {
  constructor(args: { serviceName: string; health: string | null }) {
    super({
      serviceName: args.serviceName,
      health: args.health,
      message: `swarm convergence failed for service ${args.serviceName} (health=${args.health ?? "n/a"})`,
    });
  }
}
