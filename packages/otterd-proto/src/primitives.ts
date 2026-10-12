/**
 * Primitive wire types shared by every otterd message (mirror of the Rust
 * `num` and `ids` modules in `apps/otterd/crates/otterd-proto`).
 *
 * Integers are JSON numbers capped at 2^53 − 1 so they survive a double; ids
 * are opaque, validated strings; digests and nonces are lowercase hex.
 */
import { z } from "zod";

/** A non-negative integer no larger than `Number.MAX_SAFE_INTEGER` (Rust `U53`). */
export const u53 = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const u32 = z.number().int().min(0).max(0xffff_ffff);
export const u16 = z.number().int().min(0).max(0xffff);
export const u8 = z.number().int().min(0).max(0xff);
export const i32 = z
  .number()
  .int()
  .min(-(2 ** 31))
  .max(2 ** 31 - 1);
/** Rust `i64`, restricted to the exactly representable range. */
export const i64 = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

export const ID_PATTERN = /^[A-Za-z0-9._:/@+-]{1,128}$/;

/** An opaque identifier (`[A-Za-z0-9._:/@+-]`, 1..=128 characters). */
export const wireId = z.string().regex(ID_PATTERN);

export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
export const nonce = z.string().regex(/^[0-9a-f]{64}$/);
export const keyId = z.string().regex(/^[0-9a-f]{32}$/);

/** Ed25519 / X25519 / WireGuard public key: standard base64 of 32 bytes. */
export const publicKey = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);

export const slotRef = z.strictObject({
  resourceId: wireId,
  index: u32,
});
export type SlotRef = z.infer<typeof slotRef>;
