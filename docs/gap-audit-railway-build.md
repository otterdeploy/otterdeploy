# Gap audit: Railway build system / experience vs otterdeploy

**Source:** Build logs and the Deployments UI from the same real "waves" deployment (see
`gap-audit-railway-vs-otterdeploy.md` and `gap-audit-railway-networking.md`). This doc is
specifically about the **build stage** — validation, lifecycle visibility, logs, caching, and
config-as-code.

Important framing: **otterdeploy's build *engine* is fine.** It uses `docker buildx` on cache
builders, layer caching works, and it built the exact multi-stage Dockerfile successfully. The
gaps are in **validation, legibility, and the build↔deploy boundary**, not raw build capability.

---

## Side-by-side, from the actual logs

**otterdeploy build (from the pasted web log):**
```
building image otterdeploy-local/waves-waves-stack-waves:63f716b… from Dockerfile
$ docker buildx build --builder otterdeploy-cache -f …/Dockerfile --load --progress plain …
#1 [internal] load build definition from Dockerfile   … done
#13 [deps 4/4] RUN bun install --frozen-lockfile --production …   CACHED
#16 [client 7/7] RUN bun run build   # → /app/dist       CACHED
#18 exporting to oci image format … DONE
Deploying stack waves-waves-stack — 1 service(s), reason: redeploy
Service waves: failed — Failed query: insert into "service_resource" (…) values (…)
Stack deploy failed — 0 rolled out, failed: waves
```
→ The **build succeeded**; the **deploy** failed with a raw SQL error (a name collision). The
two phases blur together in one opaque log.

**Railway build (from "View logs"):**
```
fetched snapshot sha256:e04e896… (1.9 MB)
fetching snapshot … unpacking archive
dockerfile invalid: docker VOLUME at Line 61 is not supported, use Railway Volumes
scheduling build on Metal builder "builder-xbupeh"
```
→ Railway **validated the Dockerfile before building**, failed in ~4s, and told us the exact
line, the exact problem, and the exact fix. One line changed and it built.

**Railway Deployments UI** (staged, with per-step status + timings):
```
FAILED  railway up
  ✗ Deployment failed during build process        (00:10)
  ✓ Initialization                                 (00:05)
  ✗ Build › Build image                            (00:04)
        Failed to build an image. [View build logs]
  ⓘ Try running a diagnosis…            [Diagnose]
  ○ Deploy                                          Not started
  ○ Post-deploy                                     Not started
```

---

## Gaps for otterdeploy

### 1. Fail-fast Dockerfile validation with actionable errors
- **Railway:** rejected `VOLUME` **before** the build, in 4s, with `dockerfile invalid: docker
  VOLUME at Line 61 is not supported, use Railway Volumes` — line number + reason + fix.
- **otterdeploy:** **silently accepted the same `VOLUME`** and built the image. Worse than a
  hard error: the resulting volume wasn't truly persistent, so the failure mode is invisible
  until data disappears.
- **Recommendation:** validate the Dockerfile (and unsupported instructions, missing COPY
  sources, bad base images) up front and fail fast with `file:line + reason + fix`. A clear,
  early rejection beats a silent wrong build.

### 2. A staged build/deploy lifecycle that's visible
- **Railway:** `Initialization → Build › Build image → Deploy → Post-deploy`, each with a
  ✓/✗ and a timing, so you see exactly *which* phase failed.
- **otterdeploy:** build and deploy are one flat log; a *successful build* that then fails at
  *deploy* (the `service_resource` insert) looks like one undifferentiated failure.
- **Recommendation:** model deployments as explicit phases (`fetch → validate → build →
  push → deploy → health/post-deploy`) with per-phase status, timings, and the phase that
  failed highlighted — in both CLI (`otterdeploy deployments <resource>`) and dashboard.

### 3. Build logs always retrievable, per resource and per deployment
- **Railway:** every deployment has **View logs** and `railway logs --build`; we got the exact
  error from the CLI/UI immediately.
- **otterdeploy:** `otterdeploy logs <stack> --build` returned **`Resource not found`** for
  compose stacks; the only way to read the build error was the user pasting it from the web.
- **Recommendation:** `otterdeploy logs --build [--deployment <id>]` must work for **every**
  resource type (services *and* composes), streaming and historical.

### 4. Clear build↔deploy boundary (don't leak internals)
- **otterdeploy:** a deploy-phase failure surfaced as a **raw Postgres error**
  (`Failed query: insert into "service_resource" …`) inside the build log — mixing an internal
  control-plane error into what should be a user-facing build/deploy result.
- **Recommendation:** never surface raw SQL/control-plane errors. Map them to actionable
  messages ("a service named 'waves' already exists in this project") and attribute them to the
  correct phase (deploy, not build).

### 5. Config-as-code for build/builder selection
- **Railway:** a `railway.json` / `railway.toml` (a dedicated **Config-as-code** tab) controls
  the builder explicitly:
  ```json
  { "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
    "deploy": { "startCommand": "…", "restartPolicyType": "ON_FAILURE" } }
  ```
  This removed ambiguity when auto-detection wasn't what we wanted.
- **otterdeploy:** builder behavior is inferred; `export` showed `framework: vite (package.json)`
  auto-detection with no obvious in-repo override for "use the Dockerfile, this path."
- **Recommendation:** support an in-repo build/deploy config (builder, dockerfile path, build
  args, start command, healthcheck, restart policy) so the repo is the source of truth and
  auto-detection can be overridden explicitly.

### 6. Builder choice + auto-detection, surfaced
- **Railway:** Dockerfile / Nixpacks / Railpack, with the chosen builder visible and overridable.
- **otterdeploy:** auto-detects (e.g., "framework: vite") but the *chosen* builder and *why*
  isn't surfaced, and there's no `build` command for composes to force a rebuild.
- **Recommendation:** show the selected builder + detection reason in `status`/logs, and provide
  `otterdeploy build <resource>` (incl. composes) to force a rebuild from branch HEAD.

### 7. One-click failure diagnosis
- **Railway:** a **Diagnose** button on failed deployments.
- **Recommendation:** an `otterdeploy diagnose <deployment>` (and a dashboard button) that reads
  the phase logs and returns the likely cause + fix (e.g., "unsupported `VOLUME` at Dockerfile:61",
  "name collision on service 'waves'", "no process listening on container port 8000").

### 8. Fast feedback (fail early, don't build the whole thing)
- **Railway:** caught the fatal `VOLUME` at 4s, before any layers ran.
- **otterdeploy:** built all stages (cache-hit, ~fast) and only failed later at deploy — fine
  here because of caching, but validation-before-build is still the right default so real
  errors don't wait for a full build.
- **Recommendation:** run cheap static validation (Dockerfile parse, unsupported instructions,
  config sanity, name/port conflicts) *before* scheduling the builder.

---

## What otterdeploy already does well (keep)

- **`docker buildx` on dedicated cache builders** with local layer cache (`--cache-from/--cache-to
  type=local`) — real caching, fast rebuilds on cache hits.
- **OCI image export + registry-less local images** for self-hosted flow.
- Multi-stage Dockerfiles build correctly end-to-end (the engine is not the problem).

---

## Priority order (build)

1. **Validate before building, fail fast with `file:line + reason + fix`** (#1, #8) — the
   `VOLUME` moment is the template: turn silent-wrong-builds into loud-clear errors.
2. **Build logs retrievable for every resource, incl. composes** (#3) — you cannot fix what you
   cannot see.
3. **Explicit staged lifecycle** (#2) + **clean build↔deploy boundary with no raw SQL** (#4) —
   so a deploy-phase failure never masquerades as a build failure.
4. **Config-as-code for builder/deploy** (#5) + **surfaced builder choice + `build` for composes**
   (#6).
5. **Diagnose** (#7).

---

*Same through-line as the other two audits: otterdeploy's capability is there (the image builds),
but the **experience** isn't legible — validation is silent, logs are unreachable for composes,
and a control-plane SQL error leaks into the build output. Railway wins by validating early,
naming the exact fix, and showing every phase.*
