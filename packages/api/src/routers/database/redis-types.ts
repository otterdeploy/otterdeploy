/**
 * Shared value types for the Redis data-viewer engine. Split out of `redis.ts`
 * so the engine, its Lua scripts, and the value-shaping helpers can reference
 * one canonical contract without an import cycle.
 */

export interface RedisKey {
  name: string;
  type: string;
  ttl: number;
}

export interface RedisKeyspaceEntry {
  index: number;
  keys: number;
  expires: number;
}

export interface RedisValue {
  key: string;
  type: "string" | "list" | "set" | "hash" | "zset" | "stream" | "none";
  ttl: number;
  length: number;
  truncated: boolean;
  binary: boolean;
  string: string | null;
  rows: { columns: string[]; cells: string[][] } | null;
}
