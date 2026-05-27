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
export const STEP_IDS: readonly Step[] = [
  "kind", "source", "builder", "image", "version", "networking",
  "resources", "storage", "variables", "advanced", "review",
] as const;

// Flat shape the form actually stores. The union narrows when validating,
// but the form always holds every field.
import type { Port } from "../form-fields/ports-field";
import type { Var } from "../form-fields/variables-field";

export interface ResourceFormState {
  __step: Step;
  kindId: string;
  name: string;
  version: string | null;
  src: "github" | "gitlab";
  repo: string;
  branch: string;
  root: string;
  autoDeploy: boolean;
  previewBranches: boolean;
  builderId: string;
  registry: string;
  image: string;
  tag: string;
  ports: Port[];
  healthPath: string;
  healthInterval: number;
  variables: Var[];
  linkedSecrets: Record<string, boolean>;
  presetId: string;
  customCpu: number;
  customMem: number;
  replicas: number;
  placement: string;
  pinnedNodeId: string | null;
  storageGb: number;
  backupsEnabled: boolean;
  backupRetention: number;
  pitr: boolean;
  highAvailability: boolean;
  /** Database-only: expose via the Caddy public proxy. OFF by default. */
  publicEnabled: boolean;
}

export const resourceDefaults: ResourceFormState = {
  __step: "kind",
  kindId: "",
  name: "",
  version: null,
  src: "github",
  repo: "",
  branch: "main",
  root: "",
  autoDeploy: true,
  previewBranches: true,
  builderId: "railpack",
  registry: "",
  image: "",
  tag: "latest",
  ports: [{ port: 3000, protocol: "http", public: true, host: "" }],
  healthPath: "/healthz",
  healthInterval: 10,
  variables: [],
  linkedSecrets: {},
  presetId: "small",
  customCpu: 0.5,
  customMem: 512,
  replicas: 1,
  placement: "any",
  pinnedNodeId: null,
  storageGb: 20,
  backupsEnabled: false,
  backupRetention: 7,
  pitr: false,
  highAvailability: false,
  publicEnabled: false,
};
