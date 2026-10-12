/**
 * The version of an env set, for optimistic concurrency on whole-set env
 * writes.
 *
 * The Variables editors replace a resource's (or a project environment's)
 * whole env set in one call. Two tabs that loaded the same set and both save
 * would silently drop each other's variables: last write wins. So a save
 * carries the version of the set its editor loaded, and the server refuses it
 * with a typed CONFLICT when the set has changed since.
 *
 * The version is a fingerprint of the set exactly as the editor sees it (key,
 * value, secret flag, sealed flag; a sealed value is never sent, so it counts
 * as ""), which is why it lives here: the browser computes it from the rows it
 * loaded, the server from the rows it holds, and the two agree without any
 * list endpoint changing shape and without a version column. A save that
 * changed nothing does not move the version, so it never makes the other tab
 * stale for no reason.
 *
 * Not a security boundary: a collision only means a stale save is accepted,
 * which is what happened on every save before this existed.
 */

export interface EnvVersionEntry {
  key: string;
  value: string;
  isSecret?: boolean;
  sealed?: boolean;
}

/** cyrb53: a fast, well-mixed 53-bit string hash, synchronous in every runtime. */
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The version of `entries`. Order-insensitive; keys are trimmed and an empty
 * key is dropped (the editors trim and drop them on save, so a draft that
 * still holds one describes the same stored set).
 */
export function envSetVersion(entries: ReadonlyArray<EnvVersionEntry>): string {
  const canonical = entries
    .map((e) => {
      const sealed = e.sealed ?? false;
      return [e.key.trim(), sealed ? "" : e.value, e.isSecret ?? false, sealed] as const;
    })
    .filter(([key]) => key.length > 0)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const text = JSON.stringify(canonical);
  const hex = (n: number) => n.toString(16).padStart(14, "0");
  return `ev1-${hex(cyrb53(text, 0))}${hex(cyrb53(text, 0x9e3779b9))}`;
}
