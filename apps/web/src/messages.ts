// WebSocket control-plane message contract for the PTY terminal.
//
// PTY stdin/stdout travel as raw BINARY frames and are intentionally NOT
// modeled here: only JSON control messages (text frames) belong in these
// unions. The wire format is one contract for both directions.
//
// NOTE: this file is duplicated at apps/server/src/messages.ts, NOT a symlink, despite what
// this comment used to claim. The two are byte-identical except for which
// union each side exports (ServerMessage here, since that is the one this
// app receives). Keep both in step when the wire format changes.

import * as z from "zod/v4";

// Client -> Server control messages.
const ClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session:resize"),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageOf<T extends ClientMessage["type"]> = Extract<ClientMessage, { type: T }>;

// Server -> Client control messages.
export const ServerMessage = z.discriminatedUnion("type", [
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
