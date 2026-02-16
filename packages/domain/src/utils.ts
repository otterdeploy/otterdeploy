/**
 * Strips keys whose values are `undefined` or empty strings (`""`).
 * Keeps `null`, `0`, `false`, and all other values intact.
 *
 * Useful for building Drizzle `.set()` objects from partial input —
 * only fields explicitly provided by the caller are included in the update.
 *
 * @example
 * ```ts
 * await db.update(table)
 *   .set({
 *     updatedAt: new Date(),
 *     ...pickDefined({
 *       name: input.name,       // string | undefined
 *       port: input.port,       // number | null | undefined
 *       replicas: input.replicas ?? undefined,
 *     }),
 *   })
 *   .where(eq(table.id, id));
 * ```
 */
export function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== "") {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}
