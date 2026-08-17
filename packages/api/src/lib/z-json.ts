import { isJsonObject, type JsonObject } from "@otterdeploy/shared/json";
import * as z from "zod";

/**
 * Contract schema for free-form JSON object fields (jsonb-backed configs,
 * payloads, diff details). Validates object-ness at the boundary, same
 * runtime guarantee as the old `z.record(z.string(), z.unknown())`, but
 * infers `JsonObject` on both sides of the contract, so handlers and clients
 * share one vocabulary instead of re-narrowing `unknown` values.
 */
export const zJsonObject = z.custom<JsonObject>(isJsonObject, {
  message: "expected a JSON object",
});
