/**
 * Value shaping for the Redis data-viewer engine. Turns the raw EVAL payload
 * (type + length + a type-shaped `value`) into the viewer's string-or-grid
 * contract.
 */
import type { RedisValue } from "./redis-types";

/** Split a flat [a, b, a, b, …] array into [[a, b], …] rows. */
function chunkPairs(flat: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push([flat[i] as string, flat[i + 1] as string]);
  }
  return out;
}

/** Turn the raw script payload into the viewer's string-or-grid contract. */
export function shapeValue(
  key: string,
  p: { type: RedisValue["type"]; ttl: number; length: number; value?: unknown },
): RedisValue {
  const base = {
    key,
    type: p.type,
    ttl: p.ttl,
    length: p.length,
    binary: false,
    string: null as string | null,
    rows: null as RedisValue["rows"],
  };

  const arr = Array.isArray(p.value) ? (p.value as unknown[]).map(String) : [];

  switch (p.type) {
    case "string": {
      const s = typeof p.value === "string" ? p.value : "";
      return { ...base, string: s, truncated: p.length > s.length };
    }
    case "list":
      return {
        ...base,
        rows: {
          columns: ["#", "value"],
          cells: arr.map((v, i) => [String(i), v]),
        },
        truncated: p.length > arr.length,
      };
    case "set":
      return {
        ...base,
        rows: { columns: ["value"], cells: arr.map((v) => [v]) },
        truncated: p.length > arr.length,
      };
    case "hash":
      return {
        ...base,
        rows: { columns: ["field", "value"], cells: chunkPairs(arr) },
        truncated: p.length > Math.floor(arr.length / 2),
      };
    case "zset":
      // ZRANGE WITHSCORES is flat [member, score, …]; show score first.
      return {
        ...base,
        rows: {
          columns: ["member", "score"],
          cells: chunkPairs(arr),
        },
        truncated: p.length > Math.floor(arr.length / 2),
      };
    case "stream": {
      // Each entry is [id, [field, value, …]].
      const entries = Array.isArray(p.value) ? (p.value as unknown[]) : [];
      const cells = entries.map((e) => {
        const [id, fields] = Array.isArray(e) ? e : [String(e), []];
        const fieldArr = Array.isArray(fields) ? fields.map(String) : [];
        const pairs: Record<string, string> = {};
        for (let i = 0; i + 1 < fieldArr.length; i += 2) {
          pairs[fieldArr[i] as string] = fieldArr[i + 1] as string;
        }
        return [String(id), JSON.stringify(pairs)];
      });
      return {
        ...base,
        rows: { columns: ["id", "fields"], cells },
        truncated: p.length > cells.length,
      };
    }
    default:
      // "none" — key missing or expired between list and read.
      return { ...base, truncated: false };
  }
}
