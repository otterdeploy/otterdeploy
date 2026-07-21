# Gap audit: Railway vs otterdeploy (real deploy of a stateful app)

**Source:** A real, unscripted attempt to deploy a stateful app ("waves" — a Bun/Hono
server + built React dashboard + SQLite + on-disk media, single container) to otterdeploy,
then to Railway. otterdeploy took ~2 hours of fighting and never served a working URL;
Railway got to a green build after one clear error message and a one-line fix. This
document captures the concrete gaps so otterdeploy can close them.

The app: one Docker image, listens on `:8000`, needs `WAVES_INGEST_TOKEN` (refuses to boot
without it), persists SQLite + recordings under `/data`, single replica, WebSockets +
MJPEG streaming. Nothing exotic.

---

## TL;DR — the five that hurt most

1. **Services can't persist storage.** No volumes on services; only ephemeral `diskMb`.
   This alone forces every stateful app onto the compose path.
2. **Compose stacks are second-class in the CLI.** `logs`, `deployments`, `domains`,
   `build` all reject them ("X is a compose, not a service" / "Resource not found").
   You are flying blind the moment you need persistence.
3. **No way to force a rebuild from new git.** `deploy` only reconciles resource config;
   pushing new commits + `deploy` prints `Applied 0 change(s)` and keeps the stale image.
   `build` refuses composes. The only escape was the dashboard "Redeploy" button.
4. **The edge silently fails to route.** Container healthy internally (healthcheck 200 every
   30s), but external requests returned bare `200`-with-empty-body or `502` and **never
   appeared in the app logs**. No error, no signal.
5. **Secrets set via `env set` are flagged for deletion by `deploy`.** `status` showed a
   pending `delete env WAVES_INGEST_TOKEN` — the next reconcile would wipe the token and
   crash the app. A silent footgun.

Railway had none of these. It failed *once*, with a build error that told us exactly what
to do, and everything else (service, env, volume, domain, TLS, routing) was one command each.

---

## The gaps, with evidence and recommendations

### 1. Persistent volumes for services
- **What happened:** The config schema has no `volumes`/`mount` for services — only
  `resources.diskMb` (ephemeral). Persisting SQLite + media was impossible on a plain
  service; we were pushed to a compose stack purely to get a Docker volume.
- **Railway:** `railway volume add --mount-path /data` — one command, first-class, works on
  any service.
- **Recommendation:** First-class persistent volumes on services: `otterdeploy volume add
  --service <s> --mount-path /data`. This is table stakes for stateful apps.

### 2. Compose stacks are second-class in the CLI
- **What happened:** Once on compose, every introspection command failed:
  - `otterdeploy logs waves-stack` → `Resource not found`
  - `otterdeploy deployments waves-stack` → `waves-stack is a compose, not a service`
  - `otterdeploy domains list --service waves-stack` → `is a compose, not a service`
  - `otterdeploy build waves-stack` → `is a compose, not a service`
  - Runtime logs of the *inner* service worked only by guessing its name (`logs waves`).
- **Railway:** Uniform — every resource has logs, deployments, metrics, domains.
- **Recommendation:** Treat compose stacks (and their inner services) as first-class:
  `logs`, `deployments`, `build`, `domains`, `metrics`, `restart` must all accept a stack or
  `stack:service` selector. If a name is a compose, resolve to its services rather than
  erroring.

### 3. No "rebuild from latest git" for composes (and `deploy` doesn't do it)
- **What happened:** Pushed 4 fixes to the bound branch. Every `otterdeploy deploy --yes`
  said `Applied 0 change(s)` and kept serving the old commit (`63f716b`) — because `deploy`
  diffs *resource config*, not git content. `build` rejects composes. Delete + re-add the
  stack + deploy still said `0 changes`. The deployed image only advanced when the user
  clicked **Redeploy** in the dashboard.
- **Railway:** `railway up` always uploads + rebuilds; a git push to a linked service always
  redeploys.
- **Recommendation:**
  - A `otterdeploy redeploy <service|stack>` that pulls the branch HEAD and rebuilds,
    regardless of config diff. (Parity with the dashboard "Redeploy".)
  - Make `deploy` detect that the bound branch HEAD ≠ deployed SHA and offer to rebuild.

### 4. Silent "0 changes" hides a stale deployment
- **What happened:** `deploy` reported `Applied 0 change(s) (manifest vN)` while the live
  image was several commits behind. Nothing indicated the image was stale. `export` showed
  `image: ...:63f716b...` — you had to manually compare SHAs to notice.
- **Recommendation:** Surface deployed-SHA vs branch-HEAD drift in `status`:
  `⚠ waves is 4 commits behind main (deployed 63f716b, head c8d3a9d). Run redeploy.`

### 5. Edge/routing silently fails on a healthy container
- **What happened:** Container ran fine (`Started server: http://localhost:8000`, internal
  healthcheck `200` every 30s). But `https://waves.otterstack.dev/...` returned `200` with a
  **0-byte body** for every path, or `502`, and those requests **never showed in the app
  logs** — the edge wasn't forwarding at all. HTTP and HTTPS behaved identically (so not
  TLS). This persisted across service and compose deploys, domain delete/re-add, restarts,
  and set-primary.
- **Railway:** Once the build was green, the generated domain routed immediately.
- **Recommendation:** This is the worst UX failure — a healthy container that's unreachable
  with no error. The edge should (a) route to healthy upstreams reliably, and (b) when it
  can't reach the upstream, return a **clear 502 with a reason** ("no healthy upstream on
  container port 8000"), never a bare empty `200`. Add an edge↔container reachability check
  surfaced in `status`.

### 6. TLS cert stuck at `unknown` with no visibility
- **What happened:** `domains list --json` showed `certState: "unknown"`,
  `certCheckedAt: null`, `usesAcme: true` indefinitely, even after `domains recheck`. It was
  never clear whether the cert was blocking routing.
- **Railway:** Domain + working TLS provisioned transparently in seconds.
- **Recommendation:** Surface ACME issuance state and errors explicitly
  (`pending → issuing → issued → failed(reason)`), and never leave a live domain perpetually
  `unknown`.

### 7. `env set` secrets are treated as drift and marked for deletion
- **What happened:** Setting `WAVES_INGEST_TOKEN` via `otterdeploy env set` (kept out of the
  committed config on purpose) made `status` report a pending
  `delete env waves.WAVES_INGEST_TOKEN` — i.e., the next `deploy`/`sync` would **delete the
  secret** and crash the app on boot. Workaround was to put the secret into the local config
  (and gitignore it).
- **Railway:** Variables live independently of any file-reconcile model; nothing deletes
  them behind your back.
- **Recommendation:** Treat `env set` values as *managed-outside-config* and never delete
  them during a config reconcile. Or clearly separate "config-managed env" from "imperatively
  set secrets."

### 8. Raw SQL error leaked on a name collision
- **What happened:** A standalone service `waves` plus a compose stack whose inner service
  is also `waves` collided, and the deploy failed with a raw Postgres error dumped to the
  user: `Failed query: insert into "service_resource" (...) values (...) — Stack deploy
  failed`. No hint that the real problem was a duplicate service/network name.
- **Recommendation:** Validate resource/network/hostname uniqueness up front and return a
  friendly error ("a service named 'waves' already exists in this project; pick another
  stack service name"). Never surface raw SQL.

### 9. Build-failure diagnostics are opaque; Railway's are actionable
- **What happened (otterdeploy):** Compose build failures were only visible in a pasted web
  log; the CLI had no `build` logs for composes.
- **What happened (Railway):** Build failed at 4s with a one-liner that solved it instantly:
  `dockerfile invalid: docker VOLUME at Line 61 is not supported, use Railway Volumes`.
  (Notably, **otterdeploy silently accepted the same `VOLUME` instruction** — it "worked" but
  the volume wasn't really persistent, which is arguably worse than Railway's hard, clear
  rejection.)
- **Recommendation:** Make build + deploy logs always retrievable per resource (incl.
  composes) via the CLI (`logs --build`). Validate unsupported Dockerfile instructions at
  build time with an actionable message, the way Railway does.

### 10. Domain UX friction
- **What happened:** Auto-assigned domain, then delete/re-add left it `isPrimary: false` and
  needed `set-primary`; routing behavior changed with each. Several commands and much
  confusion for "give me a URL."
- **Railway:** `railway domain` → `🚀 https://waves-production-bd45.up.railway.app`, done.
- **Recommendation:** One-command working domain; auto-mark primary when it's the only one;
  don't change routing semantics on re-add.

### 11. `env set` returned `INTERNAL_SERVER_ERROR` but actually persisted
- **What happened:** `otterdeploy env set --service waves WAVES_INGEST_TOKEN=...` printed
  `ERROR INTERNAL_SERVER_ERROR` twice, yet `env list` showed the value was set. Confusing and
  erodes trust.
- **Recommendation:** Fix the error path / idempotency so a successful write reports success.

### 12. Compose/volume schema is undocumented
- **What happened:** The JSON schema modeled `services` in detail but `composes` and the
  `exposed` item resolved to `{}` (empty), and `volume`/`mount` were absent entirely, so it
  was impossible to author a correct compose stack by reading the schema.
- **Recommendation:** Document the `composes` shape (source, gitRef, composePath, env,
  `exposed: [{service, port, domain}]`) in the schema.

### 13. No staged deploy progress / diagnosis
- **Railway:** Deployment view shows `Initialization → Build image → Deploy → Post-deploy`
  with per-step status, timings, and a **Diagnose** button on failure.
- **otterdeploy:** No equivalent per-step visibility; `status` shows a config diff, not a
  deploy lifecycle.
- **Recommendation:** Add a staged deployment lifecycle with per-step status + a one-click
  diagnosis, in both CLI and dashboard.

---

## What Railway did well (worth copying)

- **One-shot service + env:** `railway add --service waves --variables K=V --variables K2=V2`.
- **One-shot volume:** `railway volume add --mount-path /data`.
- **One-shot domain + TLS:** `railway domain`.
- **`railway up` always builds+deploys** the current directory — zero ambiguity about whether
  a rebuild happened.
- **Uniform resource model:** every resource has logs, deployments, metrics, domains,
  variables, volumes.
- **Clear, actionable build errors** (the `VOLUME` message), surfaced in both CLI and UI.
- **Instant, transparent domain + TLS.**
- **Config knob for the builder** (`railway.json` `{ "build": { "builder": "DOCKERFILE" } }`)
  when auto-detection isn't wanted.

---

## Suggested priority order for otterdeploy

1. **Persistent volumes on services** (#1) — unblocks all stateful apps without the compose
   detour.
2. **Edge routing correctness + clear 502s** (#5) — a healthy-but-unreachable container with
   no error is the single most damaging experience.
3. **First-class compose CLI** (#2) and **rebuild-from-git** (#3, #4) — you must be able to
   see and redeploy what you shipped.
4. **Don't delete `env set` secrets on reconcile** (#7) — prevents a data-loss/outage footgun.
5. **Friendly errors** for name collisions (#8), build failures (#9), and `env set` (#11);
   **domain/TLS clarity** (#6, #10); **schema docs** (#12); **staged deploy view** (#13).

---

*Written from a single real deployment session; every error string and command above is
verbatim from that run.*
