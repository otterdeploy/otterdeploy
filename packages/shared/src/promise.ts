/**
 * Resolve after `ms` milliseconds. Identical to the inline
 * `new Promise(resolve => setTimeout(resolve, ms))` that used to live
 * in cli/auth-flow, cli/commands/login, and api/routers/project/resource-logs.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
