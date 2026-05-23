import { TaggedError } from "better-result";

export class SwarmOperationError extends TaggedError("SwarmOperationError")<{
  message: string;
  step: string;
  cause: unknown;
}>() {
  constructor(args: { step: string; cause: unknown }) {
    const msg = args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      step: args.step,
      cause: args.cause,
      message: `swarm ${args.step} failed: ${msg}`,
    });
  }
}
