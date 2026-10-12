import { TaggedError } from "better-result";

/**
 * A whole-set env save built from a set that has changed since its editor
 * loaded it (another tab, a teammate, `env set`). Saving it would replace the
 * set and silently drop what the other writer added, so it is
 * refused; the editor reloads the current set and re-applies its edits.
 */
export class EnvVersionConflictError extends TaggedError("EnvVersionConflictError")<{
  message: string;
  expectedVersion: string;
  currentVersion: string;
}>() {
  constructor(args: { expectedVersion: string; currentVersion: string }) {
    super({
      ...args,
      message:
        "These variables changed since this editor loaded them. Reload to merge your edits with the current set, then save again.",
    });
  }
}
