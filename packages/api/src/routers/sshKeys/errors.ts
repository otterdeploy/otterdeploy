import type { ServerId, SshKeyId } from "@otterdeploy/shared/id";

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

/** Servers still sign in with this key; deleting it would cut them off. */
export class SshKeyInUseError extends TaggedError("SshKeyInUseError")<{
  message: string;
  id: SshKeyId;
  servers: { serverId: ServerId; name: string }[];
}>() {
  constructor(args: { id: SshKeyId; servers: { serverId: ServerId; name: string }[] }) {
    super({
      id: args.id,
      servers: args.servers,
      message: `This key is in use by ${args.servers.map((s) => s.name).join(", ")}. Servers sign in with it, so it can't be deleted.`,
    });
  }
}

/** Where a rotation stood on one server. See rotateSshKey for the sequence. */
export type RotateStep = "connect" | "add" | "verify" | "cleanup";

export type RotateServerOutcome =
  /** New key installed and checked, old key removed. */
  | "reauthorized"
  /** New key installed and checked and stored; removing the old public key
   *  failed, so the server still accepts it too. */
  | "old_key_kept"
  /** This server is why the rotation stopped. */
  | "failed"
  /** The new key was added here, then removed again when the rotation
   *  stopped. The server accepts the old key exactly as before. */
  | "rolled_back"
  /** The new key was added here and removing it again failed. The old key
   *  still signs in; an unused public key is left in authorized_keys. */
  | "rollback_failed";

export interface RotateServerResult {
  serverId: ServerId;
  name: string;
  outcome: RotateServerOutcome;
  /** The step that failed, for `failed` / `old_key_kept` / `rollback_failed`. */
  step: RotateStep | null;
  error: string | null;
}

/** A server couldn't take the new key, so nothing was swapped. */
export class SshKeyRotateFailedError extends TaggedError("SshKeyRotateFailedError")<{
  message: string;
  id: SshKeyId;
  servers: RotateServerResult[];
}>() {
  constructor(args: { id: SshKeyId; servers: RotateServerResult[] }) {
    const failed = args.servers.filter((s) => s.outcome === "failed").map((s) => s.name);
    super({
      id: args.id,
      servers: args.servers,
      message: `Not rotated: ${failed.join(", ")} couldn't take the new key. Every server still accepts the current key.`,
    });
  }
}

/** The key was rotated or replaced by someone else while this rotation ran. */
export class SshKeyChangedError extends TaggedError("SshKeyChangedError")<{
  message: string;
  id: SshKeyId;
}>() {
  constructor(args: { id: SshKeyId }) {
    super({
      id: args.id,
      message: "This key changed while it was being rotated. Reload and try again.",
    });
  }
}
