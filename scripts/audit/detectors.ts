/**
 * Regex signal detectors for the audit triage.
 *
 * Deliberately regex-based rather than AST-based: these are TRIAGE signals whose
 * only job is to rank files for human attention. A false positive costs one
 * glance; an AST pass only runs on parseable TS, so it would silently skip the
 * files most likely to be broken.
 *
 * See docs/audit/RUBRIC.md for what each signal is evidence OF.
 */

export const DETECTORS = {
  // ── Axis 1: error model
  /** `try {` — every one is a claim that this failure is exceptional. */
  tryCatch: /^[ \t]*try[ \t]*\{/gm,
  /** `.catch(` — often a swallowed error with no Result to carry it. */
  promiseCatch: /\.catch\(/g,
  /** Raw throws. */
  throws: /\bthrow\s+new\b/g,
  /** Does this file speak Result at all? */
  usesResult: /from\s*["']better-result["']/g,

  // ── Axis 2: type provenance
  /** Hand-written type/interface declarations. */
  handTypes: /^[ \t]*(?:export\s+)?(?:interface|type)\s+[A-Z]/gm,
  /** Hand-written row/record/view types — the shapes most likely to be derivable. */
  rowTypes: /^[ \t]*(?:export\s+)?(?:interface|type)\s+\w*(?:Row|Record|View|Info|Snapshot)\b/gm,
  /** String-literal unions of 3+ members — the shape of a restated pgEnum. */
  literalUnions: /(?:["'][a-z][a-z0-9-]*["']\s*\|\s*){2,}["'][a-z][a-z0-9-]*["']/g,
  /** Zod schema constructors. */
  zodSchemas: /\bz\.(?:object|union|discriminatedUnion|enum|array|record|tuple)\(/g,
  /** Types DERIVED from a zod schema. */
  zodInfer: /\bz\.(?:infer|input|output)</g,
  /** Types derived from a drizzle table — the API's largest untapped source. */
  drizzleInfer: /\$infer(?:Select|Insert)|Infer(?:Select|Insert)Model/g,
  /** Does this file touch the DB schema at all? */
  usesDbSchema: /from\s*["']@otterdeploy\/db\/schema/g,
  /** Does this file derive its types from the oRPC contract? */
  infersContract: /InferRouterOutputs|InferRouterInputs/g,

  // ── Axis 4: escape hatches
  /** `as Foo` assertions (excluding `as const`) — the type system overruled. */
  casts: /\bas\s+(?!const\b)[A-Z][A-Za-z0-9_]*(?:<[^>]*>)?(?:\[\])?/g,
  /** `as unknown as` — the two types are provably incompatible. */
  doubleCasts: /\bas\s+unknown\s+as\b/g,
  /** Non-null assertions: `x!.y`, `x!)`. */
  nonNullAssert: /[A-Za-z0-9_\])]![.)[\s,;]/g,
  /** Suppression comments — each is an unreviewed exception. */
  suppressions: /@ts-(?:expect-error|ignore|nocheck)|oxlint-disable|eslint-disable/g,

  // ── Axis 6: module graph
  /** Re-export lines — candidate facades; these are what closed our cycles. */
  reExports: /^export\s+(?:\*|\{[^}]*\})\s*from\s*["']\./gm,
} as const;

export type SignalName = keyof typeof DETECTORS;
export type Signals = Record<SignalName, number>;

/**
 * Paths where a defect is a security or data-integrity incident rather than a
 * bug. Files here escalate on ANY signal — the base64url codec sat in eight
 * copies precisely because nothing ever forced a second look at them.
 */
export const HIGH_STAKES =
  /(crypto|secret|token|auth|authz|permission|capability|egress|firewall|backup|restore|delete|remove|guard|encrypt|decrypt|password|credential|session)/i;

/** Generated or vendored — reviewing these is wasted effort. */
export const EXCLUDED = /(\.gen\.ts|route-tree|\/__generated__\/|\/shared\/components\/ui\/|\.d\.ts$)/;

export function countSignals(source: string): Signals {
  const out = {} as Signals;
  for (const [name, re] of Object.entries(DETECTORS) as [SignalName, RegExp][]) {
    // Reset lastIndex — these are shared module-level /g regexes.
    re.lastIndex = 0;
    out[name] = (source.match(re) ?? []).length;
  }
  return out;
}
