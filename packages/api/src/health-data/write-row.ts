import type { JsonObject } from "@otterdeploy/shared/json";

import type { RecordKind } from "./model";

/** One ledger-bound row of a batch, its series and boot resolved. */
export interface WriteRow {
  sid: number;
  t: number;
  boot: number;
  seq: number;
  kind: RecordKind;
  state: number;
  unc: number;
  ttl: number;
  lat: number | null;
  att: readonly number[] | null;
  vals: readonly (number | null)[] | null;
  digest: Buffer;
  probe: { round: number; outcome: number; cause: number; detail: JsonObject } | null;
}
