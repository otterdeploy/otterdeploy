/**
 * The bulk channel (PLAN §5.1); mirror of `bulk.rs`. Text frames are JSON;
 * binary frames carry data after an 8-byte header:
 * `[version u8 = 1][pipe u8][reserved u16 = 0][stream id u32 big-endian]`.
 */
import { Result } from "better-result";
import { z } from "zod";

import { sha256Hex, i32, u16, u32, u53 } from "./primitives";

export const DATA_HEADER_VERSION = 1;
export const DATA_HEADER_LEN = 8;

const PIPES = ["stdin", "stdout", "stderr"] as const;
export const pipe = z.enum(PIPES);
export type Pipe = z.infer<typeof pipe>;

export interface DataHeader {
  pipe: Pipe;
  streamId: number;
}
export type DataHeaderError = "short" | "version" | "pipe" | "reserved";

export function encodeDataHeader(header: DataHeader): Uint8Array {
  const out = new Uint8Array(DATA_HEADER_LEN);
  const view = new DataView(out.buffer);
  view.setUint8(0, DATA_HEADER_VERSION);
  view.setUint8(1, PIPES.indexOf(header.pipe));
  view.setUint32(4, header.streamId, false);
  return out;
}

export function decodeDataHeader(
  frame: Uint8Array,
): Result<{ header: DataHeader; data: Uint8Array }, DataHeaderError> {
  if (frame.length < DATA_HEADER_LEN) return Result.err("short");
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  if (view.getUint8(0) !== DATA_HEADER_VERSION) return Result.err("version");
  if (view.getUint16(2, false) !== 0) return Result.err("reserved");
  const pipeName = PIPES[view.getUint8(1)];
  if (pipeName === undefined) return Result.err("pipe");
  return Result.ok({
    header: { pipe: pipeName, streamId: view.getUint32(4, false) },
    data: frame.subarray(DATA_HEADER_LEN),
  });
}

export const bulkFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("credit"), streamId: u32, pipe, bytes: u32 }),
  z.object({
    type: z.literal("end"),
    streamId: u32,
    pipe,
    totalBytes: u53,
    sha256: sha256Hex.optional(),
  }),
  z.object({
    type: z.literal("exit"),
    streamId: u32,
    status: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("code"), code: i32 }),
      z.strictObject({ kind: z.literal("signal"), signal: z.string() }),
    ]),
  }),
  z.object({ type: z.literal("resize"), streamId: u32, cols: u16, rows: u16 }),
  z.object({
    type: z.literal("reset"),
    streamId: u32,
    code: z.enum([
      "credit-violation",
      "max-bytes-exceeded",
      "digest-mismatch",
      "deadline-exceeded",
      "cancelled",
      "unknown-stream",
      "internal",
    ]),
    message: z.string().optional(),
  }),
]);
export type BulkFrame = z.infer<typeof bulkFrame>;
