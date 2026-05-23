import { TaggedError } from "better-result";

// PTY backend errors — host shell + container exec.

export class PtySpawnError extends TaggedError("PtySpawnError")<{
  message: string;
  cause: unknown;
}>() {
  constructor(args: { cause: unknown }) {
    const msg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({ cause: args.cause, message: `host shell spawn failed: ${msg}` });
  }
}

export class PtyTerminalUnavailableError extends TaggedError(
  "PtyTerminalUnavailableError",
)<{
  message: string;
}>() {
  constructor() {
    super({ message: "spawned process has no terminal handle" });
  }
}

export class PtyExecError extends TaggedError("PtyExecError")<{
  step: "create" | "start";
  message: string;
  cause: unknown;
}>() {
  constructor(args: { step: "create" | "start"; cause: unknown }) {
    const msg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      step: args.step,
      cause: args.cause,
      message: `exec ${args.step} failed: ${msg}`,
    });
  }
}

// Inbound WS message decoding errors.

export class PtyMessageError extends TaggedError("PtyMessageError")<{
  reason: "invalid-json" | "invalid-schema";
  message: string;
  cause?: unknown;
}>() {
  constructor(args: {
    reason: "invalid-json" | "invalid-schema";
    message: string;
    cause?: unknown;
  }) {
    super(args);
  }
}

// Server startup step errors.

export class BootstrapError extends TaggedError("BootstrapError")<{
  step: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { step: string; cause: unknown }) {
    const msg =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      step: args.step,
      cause: args.cause,
      message: `bootstrap step "${args.step}" failed: ${msg}`,
    });
  }
}
