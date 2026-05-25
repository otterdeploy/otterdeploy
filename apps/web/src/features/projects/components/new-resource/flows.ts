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

export function flowFor(kind: ServiceKind | null): StepEntry[] {
  if (!kind) return KIND_STEPS;
  if (kind.group === "data") return DB_STEPS;
  if (kind.id === "docker") return DOCKER_STEPS;
  if (kind.group === "compute") return SOURCE_STEPS;
  return KIND_STEPS;
}
