import type { ServiceKind } from "@/features/projects/data/service-kinds";

import type { Step } from "./schemas";

export type StepEntry = [Step, string];

const KIND_STEPS: StepEntry[] = [["kind", "Source"]];

const DB_STEPS: StepEntry[] = [
  ["kind", "Source"],
  ["version", "Version"],
  ["resources", "Resources"],
  ["storage", "Storage & backups"],
  ["advanced", "Advanced"],
  ["review", "Review"],
];

const SOURCE_STEPS: StepEntry[] = [
  ["kind", "Source"],
  ["source", "Repository"],
  ["builder", "Builder"],
  ["networking", "Networking"],
  ["resources", "Resources"],
  ["variables", "Variables"],
  ["review", "Review"],
];

const DOCKER_STEPS: StepEntry[] = [
  ["kind", "Source"],
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

const SOURCE_FAST_STEPS: StepEntry[] = [
  ["kind", "Source"],
  ["source", "Repository"],
  ["networking", "Networking"],
  // Env vars are essential for almost every app (DATABASE_URL, API keys, …) —
  // keep them in the default flow, not just behind "Advanced setup".
  ["variables", "Variables"],
  ["review", "Review"],
];

const DOCKER_FAST_STEPS: StepEntry[] = [
  ["kind", "Source"],
  ["image", "Image"],
  ["networking", "Networking"],
  ["variables", "Variables"],
  ["review", "Review"],
];

const DB_FAST_STEPS: StepEntry[] = [
  ["kind", "Source"],
  ["version", "Version"],
  ["review", "Review"],
];

// A port-less compute service (background worker): same git build flow, minus
// the Networking step — it publishes no port and gets no public route.
const dropNetworking = (steps: StepEntry[]): StepEntry[] =>
  steps.filter(([step]) => step !== "networking");
const WORKER_STEPS = dropNetworking(SOURCE_STEPS);
const WORKER_FAST_STEPS = dropNetworking(SOURCE_FAST_STEPS);

export function flowFor(kind: ServiceKind | null, advanced = false): StepEntry[] {
  if (!kind) return KIND_STEPS;
  if (kind.group === "database") return advanced ? DB_STEPS : DB_FAST_STEPS;
  if (kind.id === "docker") return advanced ? DOCKER_STEPS : DOCKER_FAST_STEPS;
  if (kind.group === "source") {
    if (kind.portless) return advanced ? WORKER_STEPS : WORKER_FAST_STEPS;
    return advanced ? SOURCE_STEPS : SOURCE_FAST_STEPS;
  }
  return KIND_STEPS;
}
