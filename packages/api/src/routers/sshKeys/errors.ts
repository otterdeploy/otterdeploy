import type { SshKeyId } from "@otterdeploy/shared/id";

import { TaggedError } from "better-result";

export class SshKeyNotFoundError extends TaggedError("SshKeyNotFoundError")<{
  message: string;
  id: SshKeyId;
}>() {
  constructor(args: { id: SshKeyId }) {
    super({ id: args.id, message: `ssh key ${args.id} not found` });
  }
}

export class SshKeyConflictError extends TaggedError("SshKeyConflictError")<{
  message: string;
  fingerprint: string;
}>() {
  constructor(args: { fingerprint: string }) {
    super({
      fingerprint: args.fingerprint,
      message: `an SSH key with fingerprint ${args.fingerprint} already exists in this organization`,
    });
  }
}

export class SshKeyImportError extends TaggedError("SshKeyImportError")<{
  message: string;
}>() {
  constructor(args: { message: string }) {
    super({ message: args.message });
  }
}

/** A generated key has no private half to rotate-as-imported, etc. */
export class SshKeyNotRotatableError extends TaggedError("SshKeyNotRotatableError")<{
  message: string;
  id: SshKeyId;
}>() {
  constructor(args: { id: SshKeyId }) {
    super({
      id: args.id,
      message: `ssh key ${args.id} was imported (public-only) and can't be rotated; import a new key instead`,
    });
  }
}
