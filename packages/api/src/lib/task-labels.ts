/**
 * Read a label off a swarm task.
 *
 * The docker client types `Task.Spec` as `Record<string, unknown>`, so every
 * level down to the label has to be narrowed for real rather than asserted
 * onto. Two callers were doing that separately — `resource-instances.ts` for
 * `otterdeploy.deployment.id` and the service-down watch for
 * `otterdeploy.resource.id` — with identical bodies differing only in the key.
 *
 * They were duplicated because the obvious shared version does not typecheck:
 * `if (key in labels)` narrows nothing when `key` is a variable, so
 * `labels[key]` needs an assertion, and assertions are banned here. A type
 * PREDICATE sidesteps it: once `labels` is known to be
 * `Record<string, unknown>`, a variable key indexes it cleanly and the result
 * is `unknown`, which is exactly what the final `typeof` check wants.
 */
import type { Task } from "@otterdeploy/docker";

/** Every non-null object is soundly readable as a string-keyed bag of
 *  unknowns, which is all the dynamic reads below need. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** `Spec.ContainerSpec.Labels[key]`, or null if any level is missing or the
 *  value is not a string. */
export function taskLabel(spec: Task["Spec"], key: string): string | null {
  const containerSpec = spec?.ContainerSpec;
  if (!isRecord(containerSpec)) return null;
  const labels = containerSpec.Labels;
  if (!isRecord(labels)) return null;
  const value = labels[key];
  return typeof value === "string" ? value : null;
}
