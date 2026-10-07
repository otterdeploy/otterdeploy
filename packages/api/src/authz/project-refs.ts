/**
 * Which input fields of a procedure name a project, or an object a project
 * owns: the declaration API-key project scope is enforced from.
 *
 * A key minted for selected projects may only touch those projects. Before
 * this, the check read `input.projectId` and nothing else, so a procedure that
 * named its project `id`, or addressed a resource / route / environment /
 * inbound endpoint by its own id, was never confined at all. Now every field
 * is classified, in one of two places:
 *
 *   - CONVENTIONAL_PROJECT_REFS: a top-level field name that means the same
 *     thing in every procedure (`projectId`, `resourceId`, `routeId`, ...);
 *   - the contract's `meta.projectRefs`: what THIS procedure's fields mean,
 *     for names that vary (`id`, `slug`) and for nested paths
 *     (`target.resourceId`; `*` steps into every array element / record value).
 *     A declaration overrides the convention for that procedure.
 *
 * `none` declares that a field names nothing a project owns (a server, a
 * registry, a member...), or a child confined by a sibling reference the
 * handler also uses (a guest of `routeId`, a credential of `resourceId`).
 *
 * The middleware (../index.ts) enforces it centrally for every org-scoped
 * procedure. A top-level id-like field (`id`, `*Id`, `*Ids`) that is neither
 * conventional nor declared makes a project-scoped key FAIL CLOSED, and the
 * router walk in ./__tests__/project-refs.test.ts fails CI for any id-like
 * field, at any depth, left undeclared: a new procedure cannot skip the check
 * by naming its object differently.
 *
 * Pure: no DB. ./project-ref-scope.ts resolves the references to projects.
 */
import * as z from "zod";

/** Every kind of reference a project can be resolved from. */
const PROJECT_REF_KINDS = [
  "project",
  "projectSlug",
  "resource",
  "environment",
  "proxyRoute",
  "deployment",
  "preview",
  "backup",
  "backupSchedule",
  "inboundEndpoint",
  "analyticsEventDefinition",
] as const;

export type ProjectRefKind = (typeof PROJECT_REF_KINDS)[number];

/** What an input field names: a project-owned kind, or `none`. */
export type FieldRef = ProjectRefKind | "none";

/** Input field (or dotted path) -> what it names. */
export type ProjectRefs = Readonly<Record<string, FieldRef>>;

/** Field names that identify an object, and so must be classified. */
export const ID_LIKE_FIELD = /(^id$|Id$|Ids$)/;

/**
 * Top-level field names with one meaning in every procedure. `id` and `slug`
 * are deliberately absent: what they name depends on the procedure, so each
 * procedure that takes one declares it in its contract meta.
 */
const CONVENTIONAL_PROJECT_REFS: ProjectRefs = {
  projectId: "project",
  projectIds: "project",
  resourceId: "resource",
  resourceIds: "resource",
  hostResourceId: "resource",
  serviceResourceId: "resource",
  targetResourceId: "resource",
  environmentId: "environment",
  routeId: "proxyRoute",
  deploymentId: "deployment",
  previewId: "preview",
  // Organization-level objects, or no object at all.
  organizationId: "none",
  actorId: "none",
  bucketId: "none",
  buildServerId: "none",
  causationId: "none",
  correlationId: "none",
  channelId: "none",
  clientId: "none",
  destinationId: "none",
  destinationIds: "none",
  eventId: "none",
  gitRepoId: "none",
  groupIds: "none",
  installationId: "none",
  invitationId: "none",
  memberId: "none",
  oauthClientId: "none",
  placementServerId: "none",
  providerId: "none",
  registryId: "none",
  serverId: "none",
  sshKeyId: "none",
  zoneId: "none",
  // Children confined by a sibling reference their handler also filters on:
  // a deployment guest by `routeId` (authz/guests.ts removeGuest), an
  // ephemeral credential by `resourceId` (ephemeral-db revoke), a Docker task
  // by the service of `resourceId` (task-logs.ts), an analytics visitor hash
  // by the sites of `projectId`.
  guestId: "none",
  credentialId: "none",
  taskId: "none",
  visitorId: "none",
};

/**
 * The contract meta a procedure declares its references with:
 *
 *   get: oc.meta(projectRefs({ id: "project" })).meta({ path, tag, method })
 *
 * Typed, so a misspelt kind is a compile error, not a refused key.
 */
export function projectRefs(refs: ProjectRefs): { projectRefs: ProjectRefs } {
  return { projectRefs: refs };
}

const fieldRefSchema = z.enum([...PROJECT_REF_KINDS, "none"]);
const declaredSchema = z.object({
  projectRefs: z.record(z.string(), fieldRefSchema).optional(),
});

/**
 * A procedure's own declaration (`meta.projectRefs`), validated. Null when
 * the meta is malformed: the caller fails closed, and the router walk test
 * fails CI long before that.
 */
export function parseProjectRefs(meta: unknown): ProjectRefs | null {
  const parsed = declaredSchema.safeParse(meta ?? {});
  return parsed.success ? (parsed.data.projectRefs ?? {}) : null;
}

/** The classification of a top-level field: declared, else conventional. */
export function fieldRef(field: string, declared: ProjectRefs): FieldRef | undefined {
  // Own properties only: an input field called `toString` names nothing.
  if (Object.hasOwn(declared, field)) return declared[field];
  if (Object.hasOwn(CONVENTIONAL_PROJECT_REFS, field)) return CONVENTIONAL_PROJECT_REFS[field];
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** String ids held by a field value (a string, or an array of strings). The
 *  resolver canonicalizes them the way `zId` will before the handler runs. */
function idValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => (typeof item === "string" ? [item] : []));
}

/** Every value at a dotted path; `*` fans out over array elements / record values. */
function valuesAtPath(value: unknown, segments: readonly string[]): unknown[] {
  const [head, ...rest] = segments;
  if (head === undefined) return [value];
  if (head === "*") {
    const children = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
    return children.flatMap((child) => valuesAtPath(child, rest));
  }
  if (!isRecord(value)) return [];
  return valuesAtPath(value[head], rest);
}

export interface InputProjectRefs {
  /** Ids the input names, by kind. */
  refs: ReadonlyMap<ProjectRefKind, ReadonlySet<string>>;
  /** Top-level id-like fields with no classification. */
  undeclared: readonly string[];
}

/** The project references an input makes, under a procedure's declaration. */
export function inputProjectRefs(input: unknown, declared: ProjectRefs): InputProjectRefs {
  const refs = new Map<ProjectRefKind, Set<string>>();
  const undeclared: string[] = [];
  const add = (kind: FieldRef, value: unknown) => {
    if (kind === "none") return;
    const ids = idValues(value);
    if (ids.length === 0) return;
    const set = refs.get(kind) ?? new Set<string>();
    for (const id of ids) set.add(id);
    refs.set(kind, set);
  };
  if (!isRecord(input)) return { refs, undeclared };
  for (const [field, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const ref = fieldRef(field, declared);
    if (ref === undefined) {
      if (ID_LIKE_FIELD.test(field)) undeclared.push(field);
      continue;
    }
    add(ref, value);
  }
  for (const [path, kind] of Object.entries(declared)) {
    if (!path.includes(".")) continue;
    for (const value of valuesAtPath(input, path.split("."))) add(kind, value);
  }
  return { refs, undeclared };
}
