import type { ServiceKind } from "@/features/projects/data/service-kinds";

import type { Step } from "./schemas";

export type StepEntry = [Step, string];

export const KIND_STEPS: StepEntry[] = [["kind", "Kind"]];

export const DB_STEPS: StepEntry[] = [
  ["kind", "Kind"],
  ["version", "Version"],
  ["resources", "Resources"],
  ["storage", "Storage & backups"],
  ["advanced", "Advanced"],
  ["review", "Review"],
];

export const SOURCE_STEPS: StepEntry[] = [
  ["kind", "Kind"],
  ["source", "Source"],
  ["builder", "Builder"],
  ["networking", "Networking"],
  ["resources", "Resources"],
  ["variables", "Variables"],
  ["review", "Review"],
];

export const DOCKER_STEPS: StepEntry[] = [
  ["kind", "Kind"],
  ["image", "Image"],
  ["networking", "Networking"],
  ["resources", "Resources"],
  ["variables", "Variables"],
  ["review", "Review"],
];

// ── Fast paths ──────────────────────────────────────────────────────────
// The default flow. Only the steps the common case actually needs to make a
// decision about; everything else (builder, sizing, variables, storage,
// advanced) uses sensible defaults that the create path now persists, and is
// revealed by the "Advanced setup" toggle. Keeps "create a resource" to 3–4
// clicks instead of 6–7.

export const SOURCE_FAST_STEPS: StepEntry[] = [
  ["kind", "Kind"],
  ["source", "Source"],
  ["networking", "Networking"],
  ["review", "Review"],
];

export const DOCKER_FAST_STEPS: StepEntry[] = [
  ["kind", "Kind"],
  ["image", "Image"],
  ["networking", "Networking"],
  ["review", "Review"],
];

export const DB_FAST_STEPS: StepEntry[] = [
  ["kind", "Kind"],
  ["version", "Version"],
  ["review", "Review"],
];

export function flowFor(kind: ServiceKind | null, advanced = false): StepEntry[] {
  if (!kind) return KIND_STEPS;
  if (kind.group === "data") return advanced ? DB_STEPS : DB_FAST_STEPS;
  if (kind.id === "docker") return advanced ? DOCKER_STEPS : DOCKER_FAST_STEPS;
  if (kind.group === "compute") return advanced ? SOURCE_STEPS : SOURCE_FAST_STEPS;
  return KIND_STEPS;
}
