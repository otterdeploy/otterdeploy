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
| 1 | **Git-sourced compose deploy throws** when `composeContent` is empty | `compose/deploy.ts:83`. `deployCompose` is called directly from `compose/index.ts:244/267` and `manifest-reconcile.ts:162`. Only the builder path (`compose-build.ts`) clones + populates content first. | Deploying a git-backed compose stack outside a build (e.g. a re-apply / reconcile before first build) fails with a confusing "file is empty" error. Need: fetch-on-deploy, or gate the UI/handler so git compose only deploys via a build. |
| 2 | **Local-only images don't work multi-node** | Local path keeps the image in the build host's daemon (`load.ts:109-127`); other swarm nodes can't pull it. | Any git service on a >1-node cluster without a configured registry silently can't schedule on other nodes. Either require a registry for multi-node, auto-provision an in-cluster registry, or honestly gate it (ties to the runtime-driver / multi-server honesty work). |

### P2 — expected features, currently absent

| # | Gap | Evidence | Impact |
|---|-----|----------|--------|
| 3 | ~~**`watchPatterns` defined but never enforced**~~ ✅ **DONE** | Enforced in `git/handle-push.ts` via `git/watch-match.ts` (`Bun.Glob` match of pushed paths against each service's `buildConfig.watchPatterns`). Unset patterns or an unknown/truncated change set fail open → rebuild. Tests: `git/watch-match.test.ts`. | Resolved. |
| 4 | **Dockerfile build-args not plumbed** | `dockerfile.ts:160` — loop is wired but `buildArgs` is always `{}`. No path from `buildConfig` → build-args. | Users can't pass build-time args/secrets to a Dockerfile build. Needs a `buildArgs` channel in `BuildConfig` + UI + reconciler. |
| 5 | **No build layer cache across builds** | No `--cache-from/--cache-to` in `railpack.ts` / `dockerfile.ts`; only same-host buildx local cache (`handler.ts:16`). data-folder design Phase 2 (deferred). | Cold/slow builds, especially after host churn or on multi-node. Registry-backed or data-folder-backed BuildKit cache. |
| 6 | **`imageDigest` never populated** | `serviceResource.imageDigest` column exists (`schema/project.ts:380`) but no code captures the pushed/pulled digest. | No pin-to-digest / reproducible redeploy; "redeploy" of an image tag can drift. Capture digest from push/pull and store. |

### P3 — robustness / polish

| # | Gap | Evidence | Impact |
|---|-----|----------|--------|
| 7 | **Revoked GitHub installation indistinguishable from public-URL bind** | `load.ts:140` — "deferred until we add a `kind` col". | A revoked GH App install produces an opaque clone failure instead of a clear "reconnect GitHub" message. Needs a `kind` discriminator on the git binding. |
| 8 | **Stale Phase-1 comment** | `jobs/deploy.ts:5-11` claims the handler only logs. | Misleads every reader (it misled this audit's first pass). Update to point at `apps/builder`. |
| 9 | **Rollback API not surfaced in UI (verify)** | Rollback wired in API (`project/contract/deployments.ts`); no obvious button in the Deployments tab. | Confirm whether the UI exposes one-click rollback; if not, wire it. |

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
