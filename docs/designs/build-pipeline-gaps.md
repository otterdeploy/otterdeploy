# Build Pipeline — Scope & Gap Inventory

_Status: scoping doc. The build pipeline is **built and wired end-to-end**; this
catalogues the remaining gaps to make it production-complete._

## od-48w — closing the shared privileged buildx builder (host-escape vector)

**Problem** (empirically confirmed during od-5j8.15, re-confirmed here): every
tenant's Dockerfile/Railpack `RUN` step used to execute inside ONE long-lived,
SHARED buildx `docker-container` driver builder. `docker inspect` on that
builder's `buildkitd` companion showed `"Privileged": true`. This is NOT a
config mistake fixable with `--driver-opt image=...-rootless` — buildx's
`docker-container` driver hardcodes `--privileged` on the container it
creates, independent of the image inside. Any tenant build could therefore
escape to host root and reach every other tenant's build.

**Fix landed this pass**: a standalone, rootless `buildkitd` runs as its own
compose service (`buildkitd` in `docker-compose.yml` / `docker-compose.prod.yml`,
image `moby/buildkit:buildx-stable-1-rootless`, `--oci-worker-no-process-sandbox`,
`security_opt: seccomp=unconfined,apparmor=unconfined`, **no** `--privileged`,
**no** added capabilities). The builder (and its per-build helper containers)
reach it via buildx's `remote` driver (`docker buildx create --driver remote
<addr>` — see `apps/builder/src/buildx.ts`), which only opens a gRPC
connection; it never spawns, owns, or elevates a container, so there is no
privileged bootstrap step to fall back into. `apps/builder/src/pipeline-steps.ts`'s
`buildAndPublishImage` additionally routes registry-bound builds through a
direct `buildx build --push` (skips `--load` and the local docker daemon
entirely for that case — see "What still holds `docker.sock`" below).

**Verified locally (macOS, Docker Desktop)**:

- `docker inspect otterdeploy-buildkitd --format '{{.HostConfig.Privileged}}'`
  → `false`, `CapAdd=[]`, via the actual compose service (not a hand-rolled
  approximation).
- `docker buildx create --name otterdeploy-remote --driver remote <addr>`
  never creates a container; `docker buildx inspect` shows
  `Driver: remote`, `Status: running`.
- A real build through `apps/builder/src/buildx.ts` + `dockerfile.ts` (the
  actual edited source, run inside a throwaway container on the compose
  network) with a `RUN` step succeeds against the rootless buildkitd.
- **Push mode** (registry configured + remote builder available): `docker
  buildx build --push` against a real (local, for the test) registry
  succeeds with **no docker.sock mounted at all** in the invoking container,
  and with `DOCKER_HOST` pointed at a nonexistent socket — the build, the
  registry `docker login`, and the push are all daemon-independent. Digest
  recovered from `--metadata-file` (`containerimage.digest`), no `docker
  inspect` needed.
- **Load mode** (no registry — the default local/single-node path):
  `docker buildx build --builder <remote> --load` (docker.sock mounted)
  correctly imports the image into the local daemon and it runs.
- Cache: a second build of the same Dockerfile against the same buildkitd
  shows BuildKit's own `CACHED` steps with zero extra flags — no
  `--cache-from`/`--cache-to` plumbing needed anymore. The old per-repo
  local-dir cache mechanism (`DATA_ROOT/buildx-cache`, bind-mounted into every
  helper) is removed entirely (`apps/builder/src/build-workdir.ts`'s
  `pruneStaleBuildCache` deleted along with it) — buildkitd owns its own
  cache, in its own named volume, with its own size/age GC policy (visible in
  `docker buildx inspect`'s "GC Policy" rules), which nothing bind-mounts into
  a tenant-facing container.
- `docker compose -f docker-compose.yml config` / `-f docker-compose.prod.yml
  config` both validate.

**What still holds `docker.sock`, and why** (`apps/builder/src/helper-args.ts`):
the per-build helper still mounts the raw socket, narrowed to two remaining
uses, both inside the SAME helper process (not the build step itself):

1. The **local/no-registry `--load` fallback** — the default single-node
   experience with no registry configured. The image must land in the local
   daemon for the docker/swarm runtime to run it directly. Closing this
   fully needs a bundled internal registry so even the "local" path pushes
   somewhere and the runtime pulls from it (ties into gap #2 below —
   deliberately NOT built in this pass: it's swarm/runtime-driver territory,
   actively being worked on by another agent concurrently).
2. The **post-build swarm rollout** (`redeployOne` in `pipeline.ts`, which
   the SAME helper container runs after a successful build) — this
   legitimately needs to talk to the daemon to update services. Moving this
   out of the throwaway per-tenant helper and into the long-lived worker
   (which already holds the socket for other reasons) is a further container-
   boundary split not made in this pass.

Also: registry-bound builds when the remote builder is unavailable (buildkitd
down) fall back to the pre-od-48w `--load` + `docker push` + `docker inspect`
flow, unchanged — still needs the socket in that degraded case.

**Per-build isolation**: each build's `RUN` steps execute in their own
unprivileged, single-use OCI sandbox inside buildkitd. The only state shared
across tenants' builds is buildkitd's own content-addressed layer cache
(intentional — that's the entire value of a persistent builder) and the
per-build helper's ephemeral overlay filesystem is never shared (`--rm`'d
immediately). No host directory is bind-mounted into more than one tenant's
build anymore (the old `buildx-cache` bind mount is gone).

**Unverified — Linux-only, needs a real VPS/production host**:

- Rootless BuildKit's snapshotter choice: this environment auto-selected
  `overlayfs` (Docker Desktop's Linux VM supports overlayfs-on-overlayfs). A
  production host without that support may fall back to `fuse-overlayfs`,
  which needs `--device /dev/fuse` — not added here since it wasn't needed
  locally; if a real install's buildkitd logs show a fuse fallback failure,
  add `devices: ["/dev/fuse"]` to the `buildkitd` service.
- The `--oci-worker-no-process-sandbox` requirement (confirmed necessary
  here — without it every `RUN` step fails mounting `/proc`) was only
  exercised on Docker Desktop's Linux VM kernel. It's a well-documented
  upstream BuildKit rootless requirement, not something Docker-Desktop-
  specific, but a real distro's default seccomp/AppArmor/user-namespace
  configuration hasn't exercised it under this pass.
- Multi-node behavior: `BUILDER_HELPER_NETWORK`/`BUILDKIT_ADDR` resolve via
  compose service DNS, which assumes the builder and buildkitd run on the
  SAME docker/swarm host. A builder host separate from buildkitd (or from
  the swarm manager) is untested.
- Load on a long-running production buildkitd (memory/disk growth under
  sustained multi-tenant traffic, GC policy tuning) — the GC policy shown by
  `buildx inspect` is BuildKit's stock default, not tuned for this workload.
- `docker.sock`-holding steps (load fallback, swarm rollout) were not
  re-audited for capability/network isolation beyond what od-5j8.15 already
  landed (cap-drop, no-new-privileges, resource limits) — those hold.

**New finding, tracked separately (od-5j8.36, P1, NOT fixed in this pass)**:
BuildKit's OCI worker defaults to **host network mode** — a `RUN` step shares
buildkitd's own network namespace rather than an isolated one (visible in
`docker buildx inspect`'s worker labels:
`org.mobyproject.buildkit.worker.network:host`). Because `buildkitd` sits on
the same compose network as `postgres`/`redis`/`server` (no network
segmentation in either compose file), a malicious tenant `RUN` step can open
outbound connections to those services today — it has no credentials and no
host-root/privileged access (od-48w closed that), but this is still real
internal-network reachability a fully isolated build shouldn't have. Fixing
it needs `buildkitd` on its own network (internet egress only) and the
per-build helper multi-homed across that network and the default one (it
also needs direct postgres/redis reachability for its own DB/Redis clients);
the helper's `docker run` currently attaches a single `--network` at spawn
time (`apps/builder/src/helper-args.ts`), so this needs either a
`docker network connect` follow-up call or a different spawn strategy —
untested, so not attempted blind in this pass.

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
path tags `otterdeploy-local/<svc>` and runs straight from the host daemon.

## Gap inventory (prioritized)

### P1 — correctness / blocks real use

| # | Gap | Evidence | Impact |
|---|-----|----------|--------|
| 1 | ~~**Git-sourced compose deploy throws** when `composeContent` is empty~~ ✅ **DONE** | `compose/redeploy` now routes git stacks through the build worker via `enqueueComposeBuild` (`compose/build-trigger.ts`); inline stacks keep the direct path; `deployCompose`'s empty-content guard is now an honest invariant message. | Resolved. |
| 2 | **Local-only images don't work multi-node** | Local path keeps the image in the build host's daemon (`load.ts:109-127`); other swarm nodes can't pull it. | Any git service on a >1-node cluster without a configured registry silently can't schedule on other nodes. Either require a registry for multi-node, auto-provision an in-cluster registry, or honestly gate it (ties to the runtime-driver / multi-server honesty work). **Still open** — needs a registry-strategy decision. Also now the last thing keeping `docker.sock` in the per-build helper's build step (see od-48w above): an in-cluster registry would let the "local" path push too, closing that socket use as a side effect. |

### P2 — expected features, currently absent

| # | Gap | Evidence | Impact |
|---|-----|----------|--------|
| 3 | ~~**`watchPatterns` defined but never enforced**~~ ✅ **DONE** | Enforced in `git/handle-push.ts` via `git/watch-match.ts` (`Bun.Glob` match of pushed paths against each service's `buildConfig.watchPatterns`). Unset patterns or an unknown/truncated change set fail open → rebuild. Tests: `git/watch-match.test.ts`. | Resolved. |
| 4 | ~~**Dockerfile build-args not plumbed**~~ ✅ **DONE** | `BuildDockerfileConfig.buildArgs` (manifest zod with key-name validation) → `pipeline.ts` → `dockerfileBuild` → `--build-arg`; key/value editor in the service build card. Plain build-args (not secrets); applies to the explicit Dockerfile builder only. | Resolved. |
| 5 | ~~**No build layer cache across builds**~~ ✅ **DONE**, superseded by od-48w | ~~`buildx.ts`: a shared persistent `docker-container` builder + `--cache-from/--cache-to type=local,mode=max`~~ — that mechanism (and its privileged builder) is GONE. Replaced by the standalone rootless buildkitd (see od-48w above): its own internal content-addressed cache, live-verified (`CACHED` steps with zero extra flags), with a real GC policy instead of the old unbounded local-dir cache. | Resolved, verified locally against the real buildkitd. |
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
