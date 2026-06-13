/**
 * Helpers for inline `${{Source.KEY}}` reference token insertion.
 * Shared between the add-row and edit-row flows in the postgres
 * Variables tab.
 */

/** True if the value has a `${{...` fragment with no closing `}}`. */
export function hasOpenRefToken(v: string): boolean {
  const lastOpen = v.lastIndexOf("${{");
  return lastOpen >= 0 && !v.slice(lastOpen).includes("}}");
}

/**
 * Insert `token` into `current`. If the user is mid-typing a `${{...`
 * fragment, replace that fragment. Otherwise append. Never clobbers
 * unrelated prefix/suffix.
 */
export function insertRefToken(current: string, token: string): string {
  const lastOpen = current.lastIndexOf("${{");
  if (lastOpen >= 0 && !current.slice(lastOpen).includes("}}")) {
    return current.slice(0, lastOpen) + token;
  }
  if (current.length === 0) return token;
  return current + token;
}
