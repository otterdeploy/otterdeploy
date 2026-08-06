# Codebase vetting sweep — plan

How we get every source file reviewed against `docs/audit/RUBRIC.md` without the effort
collapsing halfway through.

---

## Baseline

Measured at the start of the sweep. These are the numbers the sweep has to move.

| Measure | Now |
| --- | --- |
| Source files in scope (excl. tests, generated, vendored) | 1626 |
| Import cycles / files involved | 18 / 21 |
| Clone groups / files touched | 357 / 338 |
| fallow dead-code findings | 186 |
| oxlint warnings | 196 |
| Files with `try`/`catch` | 209 |
| `as` assertions / `as unknown as` | 940 / 72 |
| Re-export lines / files | 159 / 58 |
| drizzle tables / `$inferSelect` uses | 61 / ~100 |
| zod schemas / `z.infer` uses | 1112 / 79 |
| `InferRouterOutputs` uses in `apps/web` | 4 |
| Hand-written type declarations (api / web) | 979 / 804 |

Regenerate the per-file evidence any time:

```bash
bun scripts/audit/triage.ts            # writes .audit/WORKLIST.md + worklist.json
bun scripts/audit/triage.ts --tier 3   # print a tier
bun scripts/audit/triage.ts --file <p> # single-file dossier
```

## Tiers

The triage script assigns every file a tier from mechanical evidence. This decides
**reading order and depth**, never whether a file gets reviewed — every file gets read.

| Tier | Files | Meaning |
| --- | --- | --- |
| 3 | 90 | In a cycle, or a high-stakes path (crypto/auth/delete/backup) with any signal |
| 2 | 316 | Clone group, double cast, or 3+ signals |
| 1 | 313 | One or two signals |
| 0 | 907 | No detector fired — **unreviewed, not approved** |

Tier 0 is the trap. Axis 3 (boundary honesty) and axis 8 (comment integrity) are
invisible to grep — the stale `crypto-envelope.ts` header and the `RawCert` optionality
question both sat in files no detector would have flagged. Tier 0 files get a real read;
they are just expected to be quick.

---

## Sequencing — why this order

**The order is the whole plan.** Done in the wrong order, most of the work gets done
twice. Three dependencies drive it:

1. **Graph before movement.** Every later phase moves code between files. Moving code
   across a cyclic import graph is how you get initialization-order bugs that only appear
   in production. Break cycles first.
2. **Derivation before casts.** A large share of the 940 assertions exist to paper over
   hand-written types that disagree with their source. Deriving the type deletes the cast
   for free. Fixing casts first means fixing them, then deleting them.
3. **Derivation before duplication.** Many clone groups are the *same shape* written out
   repeatedly because nothing derived it. They collapse on their own once the type has
   one home. Consolidating them first means consolidating code that was about to vanish.

Within phase 2 the layer order matters for the same reason: derive the database layer
before the contract layer, or the contract work gets redone when the row types change.

### Phase 0 — Stop the bleeding *(before any file work)* ✅

Nothing below matters if new violations land while we sweep.

```bash
bun run audit                 # totals vs the committed baseline
bun run audit --base <ref>    # + which findings this branch introduced
bun run audit --update        # re-pin the baseline after a phase lands
```

`scripts/audit/ratchet.ts` runs on every PR and every push to `main` (the `audit ratchet`
job in `.github/workflows/ci.yml`). It fails on two things:

1. **A tracked total going up**, compared against `docs/audit/baseline.json` — dead-code
   findings, import cycles, clone groups, duplicated-lines percentage.
2. **An introduced graph-shape finding** in a file the PR touched: a cycle, a re-export
   cycle, an unresolved import, a duplicate export, a boundary violation. These are gated
   separately because the totals net out — deleting an unused type elsewhere in the same
   PR would otherwise hide a new cycle.

Everything else it finds — new unused exports, new clone groups, complexity — is printed
with the file and symbol name but does not fail the build. The existing 183 findings block
nobody. Two deliberate exclusions:

- **Complexity** is oxlint's job (`complexity: max 15`, already an error). fallow's CRAP
  score assumes 0% coverage when no coverage file is passed, which makes every new
  function above cyclomatic 6 "critical" — noise, not signal.
- **`unlisted-dependencies`** is excluded because `vite-plus` is imported by ~40 test
  files while declared only at the root (od-hml). fallow attributes a project-wide finding
  to whichever file the changeset touched, so gating it would fail every PR that edits a
  test until od-hml lands.

The fallow version is pinned in `scripts/audit/fallow.ts`. Counts are not comparable
across versions, so the ratchet refuses to run when the pin and the baseline disagree —
bump both in the same commit.

The rubric becomes the code-review checklist for new PRs.

**Done when** CI fails a PR that adds a cycle or raises the clone percentage. *(Verified
both ways against a synthetic cycle and a synthetic clone group before landing.)*

### Phase 1 — Module graph *(21 files)*

Cycles and compatibility facades. Smallest phase, unblocks everything else.

- Break the 18 remaining cycles
- Delete re-export facades that exist only to preserve import paths (68 files carry
  re-exports; most are legitimate barrels — the tell is a file re-exporting from a
  sibling it was split out of)
- Replace any `await import()` used for cycle avoidance with a real graph fix

**Done when** `fallow dead-code` reports 0 circular dependencies.

### Phase 2 — Type provenance *(the big one, ~250 files)*

Strictly bottom-up. Each layer must be finished before the next begins.

**2a — Database layer.** Replace hand-written row/record types with
`typeof table.$inferSelect`. Replace string-literal unions restating a `pgEnum` with the
enum's own type. Start with `DeploymentRow` (`routers/project/deployments.ts:29`) — it is
the worst case and the pattern for the rest. *(25 `row-type-not-inferred` + 32
`restated-enum?` files.)*

**2b — Validation layer.** Collapse hand-written types sitting beside zod schemas into
`z.infer`. *(8 direct hits, plus much of the 121 `underived-types`.)*

**2c — Contract layer.** Handler input/output types derive from contract schemas.

**2d — Client layer.** `apps/web` derives API shapes via `InferRouterOutputs` instead of
re-declaring them. *(86 `web-local-types` files.)* This is last because it derives from
everything above.

**Done when** the derive-vs-declare ratio has inverted for row and wire types, and no
file declares a shape its source already defines.

### Phase 3 — Error model *(~200 files)*

Per module boundary, not per file — a module is converted with all its callers in one
change, or the mixed state gets worse rather than better.

- Modules whose failures are routine return `Result` with `TaggedError` variants
- Failure modes callers must distinguish become distinct tags (the DNS lesson)
- `.catch(() => fallback)` reviewed for discarded distinctions *(99 files)*

**Done when** no module both imports `better-result` and throws for expected failures.

### Phase 4 — Duplication *(re-triage first)*

Re-run `fallow dupes` after phase 2 — the group count will have dropped on its own.
Triage what remains by the axis-5 question ("what breaks if these disagree?"), not by
line count. Knowledge duplication is consolidated; structural coincidence is left alone.

### Phase 5 — Escape hatches

Whatever assertions survive phases 2–4 are the real ones. Each gets removed, replaced
with a schema parse or type guard, or commented with the reason.

### Phase 6 — Full file walk

Now every file is read against all eight axes, in package order. This is where axis 3 and
axis 8 finally get done. It is fast, because the mechanical findings are gone and the
reviewer is looking for judgment failures only.

Package order — smallest and most-depended-on first, so fixes propagate outward:

```
shared → db → auth → email → jobs → api → server/builder/cli → web → www
```

---

## Tracking

Beads, per the repo convention (`bd`), not markdown checklists.

- One **epic** for the sweep
- One **issue per phase**, blocked on the previous phase
- Within a phase, one issue per **batch** — a directory or module boundary, ~10–30 files.
  Not one per file: 1626 beads is a tracker nobody reads
- Each batch issue records the scorecard verdicts for its files and links any deferred
  `ISSUE` beads

Deferred findings get their own bead rather than growing the batch's diff. A batch that
balloons past its scope stops being reviewable, and an unreviewable refactor is how a
correctness bug gets in.

## Definition of done

**Per file** — every axis `OK` / `EXEMPT` (justified *in the code*), and:

```
typecheck ☐   tests ☐   fallow: no new findings for this file ☐
```

**Per batch** — all files done, one commit per concern (not one giant commit), each
commit message naming any behaviour change and whether a test covers it.

**Per phase** — the phase's exit metric above is met and the CI ratchet is tightened to
the new number, so the phase cannot regress:

```bash
bun run audit --update   # re-pins docs/audit/baseline.json
```

Then update the baseline table at the top of this file to match, in the same commit.

## Rules for the sweep

1. **Refactors do not change behaviour.** If a change needs a behaviour change to
   compile, that is a bug being introduced — stop and file it separately.
2. **When a refactor reveals the old code was wrong, say so loudly.** In the commit
   message, and state whether a test covers it. Two such changes have shipped already
   (`detectDnsProvider`'s `lookupFailed`, `verifyCloudflareToken`'s return shape); both
   are uncovered and both commits say so.
3. **Verify before deleting.** fallow's dependency findings are false-positive-prone —
   `maxmind` and `ssh2-sftp-client` were both reported unused and both are live via
   runtime-resolved dynamic imports. Grep for the name first.
4. **After any `fallow fix`, run typecheck.** It unexports without deleting, so symbols
   become unused locals and `noUnusedLocals` fails. Resolve each deliberately.
5. **A cast removed is a type inferred.** Removing an assertion can silently widen a type
   instead of erroring. Check what the inference became, not just that it compiles.
6. **Commit per concern.** Reviewability is the point; a 40-file mixed commit cannot be
   reviewed and will not be.
