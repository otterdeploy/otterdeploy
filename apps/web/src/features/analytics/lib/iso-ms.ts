/**
 * Wire timestamps (ISO strings) → epoch ms through Temporal, with a null for
 * anything unparseable rather than a NaN that poisons arithmetic downstream.
 */

import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";

export function isoMs(iso: string): number | null {
  return Result.try(() => Temporal.Instant.from(iso).epochMilliseconds).unwrapOr(null);
}
