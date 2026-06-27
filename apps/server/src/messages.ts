// WebSocket control-plane message contract for the PTY terminal.
//
// PTY stdin/stdout travel as raw BINARY frames and are intentionally NOT
// modeled here — only JSON control messages (text frames) belong in these
// unions. The wire format is one contract for both directions.
//
// NOTE: apps/web/src/messages.ts is a symlink to this file. Edit here.

import { z } from "zod/v4";

// Client -> Server control messages.
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session:resize"),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageOf<T extends ClientMessage["type"]> = Extract<ClientMessage, { type: T }>;

// Server -> Client control messages.
const ServerMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session:exit"),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum(["SPAWN_FAILED", "INVALID_MESSAGE", "INTERNAL", "MISSING_TARGET"]),
    message: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
