import * as z from "zod";

import { advancedStepSchema } from "./advanced";
import { builderStepSchema } from "./builder";
import { imageStepSchema } from "./image";
import { kindStepSchema } from "./kind";
import { networkingStepSchema } from "./networking";
import { resourcesStepSchema } from "./resources";
import { reviewStepSchema } from "./review";
import { sourceStepSchema } from "./source";
import { storageStepSchema } from "./storage";
import { variablesStepSchema } from "./variables";
import { versionStepSchema } from "./version";

export const resourceFormSchema = z.discriminatedUnion("__step", [
  kindStepSchema,
  sourceStepSchema,
  builderStepSchema,
  imageStepSchema,
  versionStepSchema,
  networkingStepSchema,
  resourcesStepSchema,
  storageStepSchema,
  variablesStepSchema,
  advancedStepSchema,
  reviewStepSchema,
]);

export type ResourceFormValues = z.infer<typeof resourceFormSchema>;
export type Step = ResourceFormValues["__step"];

// Flat shape the form actually stores. The union narrows when validating,
// but the form always holds every field.
import type { Port } from "../form-fields/ports-field";
import type { Var } from "../form-fields/variables-field";

export interface ResourceFormState {
  __step: Step;
  /** Reveal the full step flow (builder, sizing, variables, storage,
   *  advanced). Off by default → the short fast path; sensible defaults
   *  fill the hidden steps. Chosen on the first (kind) step. */
  advancedSetup: boolean;
  kindId: string;
  name: string;
  version: string | null;
  src: "github" | "gitlab";
  repo: string;
  /** Bound repo's portable "owner/repo", mirrored from the source step so the
   *  generated manifest can bind it (`repo` itself holds the opaque gitRepoId). */
  repoFullName: string;
  branch: string;
  root: string;
  autoDeploy: boolean;
  previewBranches: boolean;
  builderId: string;
  registry: string;
  image: string;
  tag: string;
  ports: Port[];
  /** HTTP health-check path probed on the primary port. Empty = no
   *  container healthcheck (process liveness only). Mapped to the same
   *  portable wget||curl `CMD-SHELL` cmd the service settings card writes
   *  (`healthcheck-http.ts`) — the manifest + swarm driver honor it. */
  healthPath: string;
  healthInterval: number;
  healthTimeout: number;
  healthRetries: number;
  /** Static-kind only: serve index.html for unmatched routes (SPA). */
  spa: boolean;
  variables: Var[];
  linkedSecrets: Record<string, boolean>;
  presetId: string;
  customCpu: number;
  customMem: number;
  replicas: number;
  placement: string;
  pinnedNodeId: string | null;
  /** Database-only: expose via the Caddy public proxy. OFF by default. */
  publicEnabled: boolean;
  /** Postgres-only: enabled extensions (canonical CREATE EXTENSION names).
   *  Staged into the manifest at create time. */
  extensions: string[];
}

export const resourceDefaults: ResourceFormState = {
  __step: "kind",
  advancedSetup: false,
  kindId: "",
  name: "",
  version: null,
  src: "github",
  repo: "",
  repoFullName: "",
  branch: "main",
  root: "",
  autoDeploy: true,
  previewBranches: true,
  builderId: "railpack",
  registry: "",
  image: "",
  tag: "latest",
  ports: [{ port: 3000, protocol: "http", public: true, host: "" }],
  // Empty by default: a prefilled "/healthz" would ship a probe most apps
  // don't serve, and a failing healthcheck blocks every rollout (swarm
  // aborts on any failed task). Opt-in, honestly.
  healthPath: "",
  healthInterval: 10,
  healthTimeout: 3,
  healthRetries: 3,
  spa: true,
  variables: [],
  linkedSecrets: {},
  presetId: "small",
  customCpu: 0.5,
  customMem: 512,
  replicas: 1,
  placement: "any",
  pinnedNodeId: null,
  publicEnabled: false,
  extensions: [],
};
