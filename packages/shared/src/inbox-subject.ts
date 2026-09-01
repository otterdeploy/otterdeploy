/**
 * What a platform event is ABOUT, carried on the event's `data` payload.
 *
 * `data` is a flat string map that every transport already forwards (Slack,
 * webhook, the in-app inbox), so the subject rides in it under four reserved
 * keys instead of a schema change across the job queue, the bus and the
 * table. One codec, used by every emitter and every reader, is what keeps
 * "everything about acme-shop/api" a question with one answer rather than a
 * string-match on titles.
 *
 * `kind` + `id` identify; `label` is for people; `project` is the slug the
 * client needs to route to a service (a resource id alone has no URL).
 */
export type InboxSubjectKind = "server" | "service" | "backup" | "edge" | "account";

export interface InboxSubject {
  kind: InboxSubjectKind;
  id: string;
  label: string;
  project?: string;
}

const KINDS: readonly InboxSubjectKind[] = ["server", "service", "backup", "edge", "account"];

/** The `data` keys the subject occupies. Readers hide them from detail views. */
export const SUBJECT_DATA_KEYS = [
  "subjectKind",
  "subjectId",
  "subjectLabel",
  "subjectProject",
] as const;

export function encodeSubject(subject: InboxSubject): Record<string, string> {
  return {
    subjectKind: subject.kind,
    subjectId: subject.id,
    subjectLabel: subject.label,
    ...(subject.project ? { subjectProject: subject.project } : {}),
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Read a subject back off a payload, or null when the emitter wrote none.
 *
 * Rows written before subjects existed carry `resource` / `project` display
 * strings only; those are NOT promoted here, because a display name is not
 * an id (two projects can both have a `web`). Readers that want a best-effort
 * label for legacy rows do that themselves, and say so.
 */
export function decodeSubject(
  data: Record<string, unknown> | null | undefined,
): InboxSubject | null {
  if (!data) return null;
  const kind = str(data.subjectKind);
  const id = str(data.subjectId);
  const label = str(data.subjectLabel);
  if (kind === null || id === null || label === null) return null;
  if (!KINDS.some((k) => k === kind)) return null;
  const project = str(data.subjectProject);
  return { kind: kindOf(kind), id, label, ...(project ? { project } : {}) };
}

/** Narrow a validated string to the union without an assertion. */
function kindOf(value: string): InboxSubjectKind {
  return KINDS.find((k) => k === value) ?? "account";
}
