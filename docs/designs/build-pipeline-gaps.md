# Build Pipeline — Scope & Gap Inventory

_Status: scoping doc. The build pipeline is **built and wired end-to-end**; this
catalogues the remaining gaps to make it production-complete._

## TL;DR

The "Phase 1: handler logs the payload only" comment in
`packages/jobs/src/jobs/deploy.ts:8` is **stale and misleading**. `apps/builder`
registers its own `deploy.triggered` worker (`makeBuildJob()`,
`apps/builder/src/handler.ts:94`) that **replaces** that stub. `apps/server`
deliberately excludes `deploy.triggered` from its workers
(`apps/server/src/index.ts:368`) so the builder owns it (it needs `railpack` +
`docker`). The real pipeline — clone → build → push → roll → mark — runs in
`apps/builder/src/pipeline.ts`.

So this is **not** "build the pipeline." It's a finite list of edges to close.

## Current state — what works today

End-to-end flow (verified):

1. **Enqueue** (5 paths, all `triggerDeploy()`):
   - Git webhook push — `packages/api/src/git/handle-push.ts:143`
   - Manifest apply (git-service creates) — `manifest-apply.ts:549`
   - Manual rebuild — `service.build` procedure → `enqueueGitBuild()`
     (`packages/api/src/routers/service/index.ts:186`)
   - Compose create — `compose/index.ts:180`
   - Compose manifest-reconcile — `compose/manifest-reconcile.ts:126`
2. **Carry** — BullMQ `deploy.triggered` queue; payload = projectId, gitRepoId,
   ref, sha, commit meta, `deploymentIds[]` (`jobs/deploy.ts:13`).
3. **Build** — builder spawns a throwaway `docker run --rm` helper per
   deployment (`handler.ts`), which runs `build-one.ts` → `pipeline.ts`:
   load → mark-building → mint GH token → clone @ sha → resolve builder
   (Dockerfile vs Railpack) → `docker buildx --load` → push (if registry bound)
   → set image → detect framework → `redeployOne()` (swarm/docker roll) →
   mark-running. Crash-safe via boot reconcile (`packages/jobs/src/reconcile.ts`).
4. **Run** — `runtime().update(spec)` recreates the container with the new image
   (`runtime/docker-driver.ts:309`); swarm driver rolls. Registry auth resolved
   on-demand from the encrypted `containerRegistry` table
   (`swarm/registry-auth.ts`).
5. **Observe** — logs dual-fan-out to `deployment_log` + Redis pub/sub; live tail
   + scrollback in the Deployments tab. `deploy.started/succeeded/failed`
   notifications fan out. Rollback wired (`project/contract/deployments.ts`).

Builders supported: **Railpack** (auto-detect, monorepo-aware, SPA/static),
user **Dockerfile**, and **Compose** (per-service build). Local-registry-less
path tags `otterstack-local/<svc>` and runs straight from the host daemon.

## Gap inventory (prioritized)

### P1 — correctness / blocks real use

| # | Gap | Evidence | Impact |
|---|-----|----------|--------|
| 1 | ~~**Git-sourced compose deploy throws** when `composeContent` is empty~~ ✅ **DONE** | `compose/redeploy` now routes git stacks through the build worker via `enqueueComposeBuild` (`compose/build-trigger.ts`); inline stacks keep the direct path; `deployCompose`'s empty-content guard is now an honest invariant message. | Resolved. |
| 2 | **Local-only images don't work multi-node** | Local path keeps the image in the build host's daemon (`load.ts:109-127`); other swarm nodes can't pull it. | Any git service on a >1-node cluster without a configured registry silently can't schedule on other nodes. Either require a registry for multi-node, auto-provision an in-cluster registry, or honestly gate it (ties to the runtime-driver / multi-server honesty work). **Still open** — needs a registry-strategy decision. |

### P2 — expected features, currently absent

| # | Gap | Evidence | Impact |
|---|-----|----------|--------|
| 3 | ~~**`watchPatterns` defined but never enforced**~~ ✅ **DONE** | Enforced in `git/handle-push.ts` via `git/watch-match.ts` (`Bun.Glob` match of pushed paths against each service's `buildConfig.watchPatterns`). Unset patterns or an unknown/truncated change set fail open → rebuild. Tests: `git/watch-match.test.ts`. | Resolved. |
| 4 | ~~**Dockerfile build-args not plumbed**~~ ✅ **DONE** | `BuildDockerfileConfig.buildArgs` (manifest zod with key-name validation) → `pipeline.ts` → `dockerfileBuild` → `--build-arg`; key/value editor in the service build card. Plain build-args (not secrets); applies to the explicit Dockerfile builder only. | Resolved. |
| 5 | ~~**No build layer cache across builds**~~ ✅ **DONE** (needs real-host smoke test) | `buildx.ts`: a shared persistent `docker-container` builder + `--cache-from/--cache-to type=local,mode=max` under the data folder; best-effort with exact fallback to the default-driver `--load` path. Cache-dir growth is unbounded — a prune is a follow-up. | Resolved pending live verification. |
| 6 | ~~**`imageDigest` never populated**~~ ✅ **DONE** | `dockerPush` captures the pushed digest (`docker inspect` RepoDigests); pipeline persists it on set-image. Local (no-registry) builds stay null. | Resolved (capture only; runtime pin-to-digest is a separate change). |

### P3 — robustness / polish

| # | Gap | Evidence | Impact |
|---|-----|----------|--------|
| 7 | ~~**Revoked GitHub installation indistinguishable from public-URL bind**~~ ✅ **DONE** (one residual) | clone + token-mint failures for an installation-backed repo now surface "reconnect GitHub", discriminated by `installationId` (no schema change). **Residual:** when a revoked install cascades `gitRepo.installationId` → null (soft-delete), it again looks like a public bind — fully closing that needs a `kind`/`isPrivate` discriminator. | Resolved for the common cases. |
| 8 | ~~**Stale Phase-1 comment**~~ ✅ **DONE** | `jobs/deploy.ts` comment rewritten to point at `apps/builder/handler.ts` (`makeBuildJob`). | Resolved. |
| 9 | ~~**Rollback API not surfaced in UI**~~ ✅ **DONE** | The doc was wrong — no general rollback existed. Built `service.rollback` (image-only) + a "Roll back to this" action on settled deployments. ⚠️ adds a `deployment_reason` enum value → needs `bun db:push`. | Resolved (image-only; full-snapshot replay deferred). |

## Also shipped this pass — deploy lifecycle hooks ✅

`preDeploy` existed in the schema/contract but was **never executed**, and
`postDeploy` didn't exist. Both now run in the build pipeline:

- **Schema**: added `post_deploy text[]` (`db/schema/project.ts`); ⚠️ **needs `bun db:push`**.
- **Execution**: `apps/builder/src/deploy-hook.ts` runs each command in a
  throwaway `docker run --rm` off the new image, on the project network, with
  the service's resolved env (so a migration reaches the DB by alias). Env is
  passed via `--env-file` (off the logged argv) + masked; `--entrypoint sh -c`
  so it runs regardless of the image's ENTRYPOINT. Output streams to the
  deployment log.
- **Pipeline** (`apps/builder/src/pipeline.ts`): `preDeploy` runs after the
  image is built but **before** the rollout — a non-zero exit aborts the roll
  (old replicas keep serving). `postDeploy` runs after the new replicas are
  live + healthy and is **best-effort** — a failure is surfaced loudly but does
  not flip a live, healthy deployment to "failed".
- **Settable** via declarative manifest apply (`preDeploy`/`postDeploy` in the
  manifest + stack schemas) and the imperative `service.create`/`service.update`
  API. ❌ **No web UI yet** — a "Deploy hooks" editor on the service build
  settings is the remaining piece.

## Recommended sequencing

1. **Registry & multi-node honesty (#2, #5, #6)** — one workstream: decide the
   registry story (require external / bundle an in-cluster registry), then layer
   cache + digest capture fall out of it naturally. This unblocks the multi-node
   value prop and ties into the runtime-driver / Coolify-multiserver-gap work.
2. **Compose git deploy (#1)** — fetch-on-deploy or handler gating. Self-contained.
3. **watchPatterns (#3)** — pure win for monorepos, isolated to `handle-push`.
4. **Build-args (#4)** + **GH `kind` col (#7)** — schema-touching, batch with the
   next `db:push`.
5. **Comment + rollback UI (#8, #9)** — cleanup.

## Open questions for the user

- Registry strategy for multi-node: **require an external registry**, or **bundle
  an in-cluster registry** so the local path keeps working at scale?
- Is build-arg **secrecy** required (BuildKit `--secret`) or are plain
  `--build-arg`s enough for v1?
- Should `watchPatterns` default to "rebuild only changed services" or stay
  opt-in (current de-facto behaviour rebuilds everything)?
