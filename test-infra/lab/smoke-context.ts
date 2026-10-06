import type { Evidence } from "./evidence";
import type { ControlPlane } from "./product";
import type { InstallMode } from "./smoke-install";
import type { LabSsh } from "./ssh";
import type { NodeState, RunState } from "./state";

/** Everything the smoke steps share. Secrets in here never reach disk unredacted. */
export interface SmokeContext {
  state: RunState;
  ssh: LabSsh;
  evidence: Evidence;
  cp: ControlPlane;
  cpNode: NodeState;
  w1Node: NodeState;
  /** `<run>.<LAB_DNS_SUFFIX>` */
  domain: string;
  email: string;
  password: string;
  installedVersion: string | null;
  installMode: InstallMode;
  /** `smoke --installer <path>`: run this local install.sh instead of the public one. */
  localInstaller: string | null;
  /** Read from cp's .env over SSH; only ever held here and in the redactor. */
  bootstrapToken: string | null;
}
