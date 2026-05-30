/**
 * Returns a shallow copy of `obj` with every entry whose value is
 * `undefined` removed. Useful when building partial-patch payloads
 * (drizzle update sets, oRPC inputs that distinguish "leave alone"
 * from "set to null") — Postgres treats an explicit `undefined`
 * column in an update set as a no-op, but spreading an object with
 * `undefined` values into a JSON request will encode `"key": null`,
 * which is a meaningfully different write. Strip first, send the
 * survivors.
 *
 * `null` is preserved — only `undefined` is stripped. The two carry
 * different intent in a patch (null = clear column, undefined = no
 * change), so collapsing them would lose information.
 *
 * Non-enumerable / symbol keys are not copied — same constraints as
 * a spread (...obj). One level deep: nested objects are not walked.
 */
export function omitUndefined<T extends object>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out = {} as { [K in keyof T]: Exclude<T[K], undefined> };
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value !== undefined) {
        out[key] = value as Exclude<T[typeof key], undefined>;
      }
    }
  }
  return out;
}
