# File vetting rubric

The standard every source file is judged against. One file, one pass, one verdict.

This is not generic TypeScript advice. Every rule below exists because the pattern was
found in **this** codebase, and each one names the real instance so the rule can be
argued with rather than obeyed.

Companion documents:

- `docs/audit/PLAN.md` — how the sweep is sequenced and tracked
- `.audit/WORKLIST.md` — generated per-file evidence (`bun scripts/audit/triage.ts`)

---

## How to use this

For each file: read it top to bottom, walk the eight axes, record a verdict per axis.

A file **passes** when every axis is `OK` or `EXEMPT (reason recorded)`. Anything else
is `FIX` (do it now) or `ISSUE` (file a bead, move on — use this when the fix crosses
file boundaries and would balloon the diff).

Two rules about the rubric itself:

1. **A clean triage sheet is not a pass.** The detectors find shapes, not judgment
   failures. Axis 2 (type provenance) and axis 8 (comment integrity) are almost
   entirely invisible to grep. A tier-0 file still has to be read.
2. **`EXEMPT` requires a written reason in the code**, not in the review notes. If the
   next reader needs the justification, it belongs in a comment. A reason that lives
   only in a review log is a reason that will be lost.

---

## Axis 1 — Error model

**Rule.** A module is either Result-returning or throwing. Never both. Failures that
are expected in normal operation (network, DNS, a rotated credential, a missing record)
return `Result`. Exceptions are reserved for programmer error and violated invariants —
conditions where continuing is worse than crashing.

**Why.** `packages/api/src/lib/cloudflare.ts` converted `CloudflareError` from its
envelope but let `fetch()` and `res.json()` throw. Callers had no way to know the module
could throw at all, so five of them wrapped it in `try`/`catch` or `Result.tryPromise`
purely to convert — adapters that existed only because the module was undecided.

**The worse failure.** `packages/api/src/lib/dns-resolver.ts` threw raw node errors, so
four callers each re-derived "authoritatively absent vs couldn't ask" by sniffing
`err.code` against their own copy of the `ENODATA`/`ENOTFOUND`/`NXDOMAIN` list. Those
copies **had already drifted** — `dns-verify.ts` was missing `NXDOMAIN`, so a
nonexistent domain reported "retry in a minute" there and "not pointed here" elsewhere.
Throwing did not just lose type information; it duplicated a decision and let the copies
diverge.

**Check.**

- [ ] The module's failure contract is one thing, stated in the file header
- [ ] Failure *modes* callers must distinguish are separate `TaggedError` types, not
      one error whose `message` or `code` the caller parses
- [ ] No `.catch(() => fallback)` that discards a distinction a caller needs
- [ ] `try`/`catch` remaining in a Result module is either at an IO boundary being
      converted, or commented as to why

**Exempt.** Top-level entry points, job workers, and route handlers that must catch to
report. Genuinely unrecoverable invariant violations (`panic`).

**Detector.** `mixed-error-model`, `throw-based`, `swallowed-rejection`

---

## Axis 2 — Type provenance

**The single largest finding in the baseline, and it is not a frontend problem.**
`packages/api` hand-writes **979** type declarations; `apps/web` writes 804. Three
derivation sources sit unused at three different layers:

| Layer | Source of truth | Derive with | Defined | Derived |
| --- | --- | --- | --- | --- |
| Database | drizzle table | `typeof t.$inferSelect` / `$inferInsert` | 61 tables | ~100 uses |
| Validation | zod schema | `z.infer<typeof schema>` | 1112 schemas | 79 uses |
| Wire | oRPC contract | `InferRouterOutputs` | whole API | **4 uses** |

Against that: 246 hand-written `Row`/`Record`/`Input`/`Output` types in the API alone.

**Rule.** If a shape is already defined somewhere — a table, a schema, a contract — the
TypeScript type is **derived** from it. Never a parallel declaration that happens to
match today.

**Direction of derivation.** Each layer derives from the one above and never re-declares:

```
drizzle table  →  zod schema  →  oRPC contract  →  handler  →  client (InferRouterOutputs)
```

**The canonical offender.** `packages/api/src/routers/project/deployments.ts:29`:

```ts
export interface DeploymentRow {
  id: DeploymentId;
  status: "pending" | "building" | "running" | "failed" | "cancelled" | "superseded" | "removed";
  reason: "create" | "redeploy" | "env-change" | "image-change" | "restart" | "git-push" | "rollback";
  // …
}
```

Both unions are **already** `pgEnum`s — `deploymentStatusEnum` and `deploymentReasonEnum`
in `packages/db/src/schema/project.ts:677,687`. This should be
`typeof deployment.$inferSelect`. As written, adding an enum value in a migration leaves
this interface silently disagreeing with the database, and the compiler cannot tell,
because it has no idea these are supposed to be the same fact.

**Why it matters more than it looks.** A hand-written type beside its source is two
descriptions of one thing. They agree the day they are written. Nothing makes them agree
afterwards — so drift is silent and surfaces in production as a shape mismatch the types
swore was impossible. It is the same failure as the duplicated DNS error-code list
(axis 5), except the compiler is actively reassuring you.

**Check.**

- [ ] Row/record types come from `$inferSelect` / `$inferInsert`, not hand-written
- [ ] No string-literal union restating a `pgEnum` — derive it from the enum
- [ ] No `interface`/`type` restating a shape a zod schema already describes
- [ ] Handler input/output types come from the contract schema, not re-declared beside it
- [ ] Frontend types for API data come from `InferRouterOutputs`, not re-declaration
- [ ] Where a type is deliberately NARROWER than its source, it is derived with
      `Pick`/`Omit`/`Extract` from the source, not written fresh
- [ ] Where it is deliberately WIDER (a joined query, a computed field), it EXTENDS the
      derived type rather than replacing it:
      `type X = typeof t.$inferSelect & { computed: string }`

**Exempt.** Shapes with no upstream definition: internal function signatures,
discriminated unions used purely for control flow, component props over local state, and
view-models that correspond to no wire or table data — name those so they read as
deliberate.

**Detector.** `row-type-not-inferred`, `restated-enum?`, `schema-and-handwritten-types`,
`web-local-types`, `underived-types`

---

## Axis 3 — Type honesty at boundaries

**Rule.** A type at an IO boundary describes what the runtime **actually returns**, not
what would be convenient. Where the two differ, the boundary validates (zod) or the type
carries a comment explaining what is unverified and why.

**Why.** `packages/api/src/lib/cert-probe.ts` declares `RawCert` with every field
optional. Node's `PeerCertificate` marks those same fields required. The optionality
looked defensive, but the empty-certificate case it appears to guard is *already*
collapsed to `null` one line earlier — so past that point the type promises less than
node guarantees, and every downstream guard reads as dead code. There may be a real
reason (Bun's TLS shim demonstrably diverges from node's in that exact call, documented
in that same file), but the code does not say so. **An unexplained hedge is
indistinguishable from a mistake.**

**Check.**

- [ ] Optional vs required matches the actual runtime contract, and where it hedges a
      known divergence, the comment names the divergence
- [ ] External JSON (HTTP responses, webhook bodies, config files) is parsed by a schema
      at the boundary, or explicitly marked unvalidated with the risk stated
- [ ] The type does not over-promise: no required field the source can omit

**Detector.** None reliable. **This axis requires reading the file.**

---

## Axis 4 — Escape hatches

**Rule.** Every `as`, `as unknown as`, `!`, and `@ts-expect-error` is an unchecked claim.
It needs either removal or a comment naming what the compiler cannot see.

**Priority order** — prefer the highest option that works:

1. Fix the type at its source (derive it — see axis 2; this deletes casts for free)
2. Parse with a schema and get a validated type
3. A type guard / predicate function
4. `as` with a comment explaining why 1–3 do not apply
5. `as unknown as` with a comment naming the specific incompatibility

**Why `as unknown as` is its own category.** The double cast means the two types are
*provably* incompatible — TypeScript rejected the single cast. That is information. In
`cert-probe.ts:81` the double cast exists because node's `Certificate` interface has six
required fields and the code needs an index signature; that is a real, explainable
mismatch, and the comment should say so rather than leaving a reader to rediscover it.

**Baseline.** 940 assertions, 72 double casts, across the repo.

**Check.**

- [ ] No cast that deriving the type would eliminate
- [ ] Every surviving `as unknown as` names its incompatibility in a comment
- [ ] No `!` where the null case is actually reachable
- [ ] Every suppression comment states what it suppresses and why

**Careful.** Removing a cast can silently widen an inferred type rather than erroring.
Removing `as DeploymentRow[]` from a drizzle `.select()` leaves the row type inferred
from the query — usually right, occasionally not. Re-run typecheck **and** look at what
the inferred type became.

**Detector.** `double-cast`, `cast-heavy`, `suppressions`

---

## Axis 5 — Single source of truth

**Rule.** A fact lives in exactly one place. A *fact* is a code list, an encoding, a
threshold, a guard condition, a format — anything where two copies disagreeing is a bug.

**Why line-counting misleads.** The most dangerous duplication found so far was
`base64UrlEncode`/`base64UrlDecode`: **8 byte-identical copies** across four packages,
about 13 lines each. By line count it was trivial. By risk it was the worst thing in the
codebase — it is the wire encoding for every secret in the database, and eight copies
that must never diverge had nothing keeping them aligned.

Meanwhile the four-way DNS error-code list — three lines — **had already drifted**, and
`listCloudflareZones`'s duplicated envelope handling had drifted too (different fallback
message, missing header).

> **Ask "what happens if these two copies disagree?"** If the answer is "a bug nobody
> would find", it is a single-source-of-truth violation regardless of how few lines it is.
> If the answer is "nothing", the similarity is coincidental — leave it alone.

**Check.**

- [ ] No constant, code list, or format string duplicated across files
- [ ] No re-implementation of something a shared package already provides
      (check `@otterdeploy/shared` before writing a helper)
- [ ] Where duplication is deliberate (a leaf package that cannot import the canonical
      one), the comment says so and names the file it mirrors
- [ ] Clone groups from fallow are triaged: consolidate, or record why not

**Exempt.** Structural similarity with no shared meaning — two routers that look alike
because they are both routers. Consolidating those couples things that should move
independently.

**Detector.** `clone-groups` (`bunx fallow dupes --trace dup:<id>`)

---

## Axis 6 — Module graph

**Rule.** No import cycles. No re-export facade whose only purpose is to preserve an old
import path.

**Why.** Seven of the eighteen remaining cycles came from one habit: `deployments.ts` was
split into siblings to stay under a file-size cap, then kept re-exporting them so call
sites would not have to change. `deployments-list.ts` states it outright — *"re-exported
so call sites keep importing from the list module."* Those facades were the back-edges.
Three layers deep in places. The fix was deleting the tail and pointing consumers at the
module that actually defines each symbol.

**The tell**: a file that re-exports from a sibling it was split out of. That is a facade,
and it will close a loop the moment anything in the group imports back.

**Also.** A dynamic `await import()` used to dodge a cycle is a smell, not a fix — it
hides the cycle from the type system while keeping it at runtime. Break the graph instead.

**Check.**

- [ ] File is in no cycle
- [ ] Re-exports form a real public API (an intentional barrel), not a compatibility shim
- [ ] Imports point at the module that DEFINES the symbol, not a re-exporter
- [ ] No `await import()` whose purpose is cycle avoidance

**Detector.** `in-import-cycle`, `re-exports`

---

## Axis 7 — Dead code

**Rule.** Unreachable code is deleted, not commented out or left exported "just in case".

**Two cautions learned the hard way.**

1. **`fallow fix` unexports; it does not delete.** A symbol that was only used via its
   export becomes an unused local, and `noUnusedLocals` fails the build. Run typecheck
   after any sweep and resolve each one deliberately — delete it, or restore the export
   with an `ignoreExports` entry saying why.
2. **Dependency findings are false-positive-prone.** `maxmind` and `ssh2-sftp-client`
   were both reported unused; both are reached through runtime-resolved dynamic imports
   the static graph cannot see. Deleting them would have killed GeoIP and SFTP backups
   silently. **Always grep for the package name before removing a dependency.**

**Check.**

- [ ] No unused exports (or an `ignoreExports` entry explaining the retention)
- [ ] In-flight work that is not yet wired is marked as such, not silently unexported
- [ ] Deleting preserved any comment carrying knowledge that outlives the code

**Detector.** `dead-code-findings`

---

## Axis 8 — Comment integrity

**Rule.** Doc comments describe what the code does now.

**Why.** `crypto-envelope.ts`'s header advertised that it owned "the base64url codec both
are spelled in" — after the codec had moved to a shared package. This codebase's comments
are unusually good and carry real reasoning, which makes a stale one *more* dangerous
than in a codebase nobody trusts: readers believe it.

**Check.**

- [ ] The file header still describes this file's actual responsibility
- [ ] No comment referring to a symbol or file that moved or no longer exists
- [ ] Comments explain WHY (constraints, trade-offs, history), not what the code plainly says
- [ ] Knowledge in a deleted function's comment was carried to wherever it now applies

**Detector.** None. **Requires reading.**

---

## Scorecard

Record one line per file. Verdicts: `OK` · `FIX` (fixed in this pass) · `ISSUE <bead-id>`
(deferred, tracked) · `EXEMPT` (justified in code).

```
file: packages/api/src/lib/example.ts          tier: 2      reviewer: ___  date: ____

  1  error model .............  OK / FIX / ISSUE / EXEMPT    ______________________
  2  type provenance .........  OK / FIX / ISSUE / EXEMPT    ______________________
  3  boundary honesty ........  OK / FIX / ISSUE / EXEMPT    ______________________
  4  escape hatches ..........  OK / FIX / ISSUE / EXEMPT    ______________________
  5  single source of truth ..  OK / FIX / ISSUE / EXEMPT    ______________________
  6  module graph ............  OK / FIX / ISSUE / EXEMPT    ______________________
  7  dead code ...............  OK / FIX / ISSUE / EXEMPT    ______________________
  8  comment integrity .......  OK / FIX / ISSUE / EXEMPT    ______________________

  verdict:  PASS / PASS-WITH-ISSUES / NEEDS-REWORK
  gates:    typecheck ☐   tests ☐   fallow (no new findings) ☐
```

**A file is not done until typecheck and tests pass and fallow reports no new findings
for it.** Every change in this sweep is a refactor; a refactor that needs a behaviour
change to compile is a bug being introduced.

---

## When a fix changes behaviour

Refactors sometimes reveal that the old code was wrong. That is a *result*, not a
licence. When it happens:

1. Say so explicitly in the commit message — do not bury it under "refactor"
2. Check whether a test covers the behaviour. If not, **say that too.** Two behaviour
   changes shipped in this sweep so far (`detectDnsProvider`'s `lookupFailed`,
   `verifyCloudflareToken`'s return shape) are uncovered by tests, and the commits say so
3. Prefer adding the test to asserting it is fine
