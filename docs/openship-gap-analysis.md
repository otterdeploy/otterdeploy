# Openship — Competitive Gap Analysis

_Source: `research/openship` (clone of `github.com/oblien/openship`, v0.1.9, AGPL-3.0 + Commons Clause, by Oblien LLC). Analysis date: 2026-07-18._

Openship is a **direct, near-identical-stack competitor**: a self-hostable Railway/Coolify/Render-class PaaS built on bun + turbo + drizzle + better-auth + Hono/oRPC — the same core stack as otterdeploy. It ships six apps (`api`, `dashboard`, `desktop`, `web`, `cli`, `email`) and six packages (`adapters`, `core`, `db`, `db-email`, `onboarding`, `ui`), ~30 API modules.

Its positioning bet is **"three interfaces + AI + built-in mail"**: desktop app, web dashboard, CLI, a REST API, and a ~103-tool MCP server, plus a full self-hosted mail server. Its architectural bet is **one binary that runs both self-hosted and a managed multi-tenant SaaS**, switched by a single `CLOUD_MODE` env flag.

---

## Architecture contrast

| Axis | otterdeploy | openship |
|---|---|---|
| Orchestration | **Docker Swarm** + registry (multi-node scheduling) | **Three pluggable runtimes**: Docker Engine API (dockerode), bare-metal (systemd, no Docker), Oblien cloud micro-VMs. No Swarm, **no registry** (images live only on the building daemon) |
| Routing/TLS | **Caddy** (autocert, HTTP/2+3, wildcard) | **OpenResty + certbot** (hand-templated vhosts, HTTP-01 only, no wildcard/HTTP-3) — but with an in-proxy Lua analytics/GeoIP/live-log layer |
| Build detection | stack/manifest + compose renderer | **~50-framework stack registry** + rule-based detector (10 languages), monorepo scoring, port sniffing |
| Job queue | BullMQ (builder worker) | BullMQ **with auto-fallback to in-process** when Redis absent; SaaS forces BullMQ |
| Multi-tenancy | self-host first (cloud design pending) | **dual self-host/SaaS from one codebase** via `CLOUD_MODE` + gateway-proxy |
| Payments | Polar | Stripe + external Oblien metering substrate |
| DB | Postgres (Drizzle) | Postgres **or embedded PGlite** (desktop/dev fallback) |

**Where otterdeploy is structurally ahead — do NOT chase these:** openship has **no build-layer caching** (no `--cache-from`, BuildKit mounts, or registry cache) and **no image registry / distribution**, so it structurally cannot do cross-node Swarm-style scheduling. Its `healthCheck` deploy gate is wired but unimplemented (no real readiness gating today). Its CDN features (edge caching, HTTP/3, Brotli, purge) advertised in the README are **absent from the code** — aspirational only. otterdeploy also already has **ephemeral COW preview databases** and **managed-DB provisioning**, which openship lacks (its databases are plain compose services).

---

## The gaps, prioritized

### Tier 1 — Strategic gaps (new product surfaces otterdeploy has nothing for)

**1. MCP server / AI-agent surface** — _biggest strategic gap._
Openship exposes a standards-compliant **Streamable-HTTP MCP server** at `/api/mcp` with **~103 permission-scoped tools auto-generated from its HTTP route registry** (a route opts in by declaring an `mcp: {description, body}` block; `tools/call` dispatches an internal request through the real Hono app, so auth/permissions/logic run identically to HTTP — zero duplication). Full **OAuth 2.1**: dynamic client registration, PKCE, consent flow, `.well-known` discovery, per-principal capability filtering, hard-denied `tokens`/`auth`/`mcp` tools so an agent can't escalate. Includes an AI-orchestrated folder-upload deploy flow. otterdeploy has **no AI-agent surface at all**.
_Files: `apps/api/src/modules/mcp/{mcp.routes,mcp-dispatch}.ts`; better-auth `mcp()` plugin in `lib/auth.ts`._
**Assessment:** high-leverage, and the auto-generate-from-routes pattern makes it cheap if otterdeploy's oRPC contracts can be reflected into tool specs. **Recommend prioritizing.**

**2. Built-in self-hosted mail server** — _openship's biggest moat, but glue-heavy not algorithmic._
A full MTA/MDA: **iRedMail** (Postfix/Dovecot/Amavis/ClamAV/SpamAssassin/iRedAPD/fail2ban on Postgres) transferred to a VPS over SSH and driven by a 13-step idempotent install pipeline, plus the **Zero** OSS IMAP webmail client vendored and **deployed as a normal openship project**. Generates DKIM/SPF/DMARC, per-domain DKIM, DNS+PTR health grading, live SMTP test-email. ~8,700 LOC of orchestration.
_Files: `apps/api/src/modules/mail/**`, `packages/core/src/mail-server/`, `packages/db-email/`, `apps/email/`._
**Assessment:** weeks-to-months to match; but both the MTA (iRedMail) and webmail (Zero) are upstream OSS, so it's an integration moat, not tech IP — and it carries the full self-hosted-mail operational burden (port 25, IP reputation, PTR). **Even openship hasn't shipped alias/catch-all/forwarding admin UI** (schema + daemons support it; nobody built the surface) — a leapfrog opening if otterdeploy pursues mail. **Recommend: decide deliberately — it's a big commitment; don't half-build.**

**3. Desktop (Electron) app** — a distribution channel otterdeploy lacks entirely.
Not a thin shell: a packaged build boots a bundled `openship-api` (`bun --compile` binary with **embedded PGlite + in-process job runner, no Postgres/Redis**) + the Next standalone dashboard on 127.0.0.1, with a **zero-auth loopback mode** (kernel-verified loopback peer), native SSH-key pickers, PKCE cloud sign-in, and a self-replacing auto-updater.
_Files: `apps/desktop/`._
**Assessment:** meaningful for the "solo dev on a laptop" segment; depends on whether otterdeploy can run headless-embedded (PGlite fallback is the enabler). Medium-large effort.

**4. Dual self-host / managed-SaaS from one codebase** — the architectural crown jewel.
A single `CLOUD_MODE` flag. Self-hosted instances keep **no local row** for cloud-deployed projects — instead a **gateway-proxy** (`cloudProjectProxy` et al.) detects a project's `source` (`local` vs `cloud`) and stream-proxies the whole request to `api.openship.io`, authenticated server-side as the org owner (the owner's SaaS session token is AES-encrypted in `user_settings`). In `CLOUD_MODE` the proxy short-circuits (every project is local), so identical controllers run on both sides. Multi-tenant compute/metering is delegated to the Oblien provider (namespaces as the security boundary).
_Files: `apps/api/src/lib/cloud/{project-router,transport}.ts`, `lib/openship-cloud.ts`._
**Assessment:** this is the most portable, self-contained idea worth studying if otterdeploy ever offers a managed tier. It aligns with the existing cloud design in `docs/designs/`. Study the gateway-proxy pattern specifically.

### Tier 2 — Feature-depth gaps (otterdeploy has the category, openship goes deeper)

**5. Fine-grained per-resource RBAC.** A 4th `restricted` role + a `resource_grant` table: default-deny, per-`(user, resourceType, resourceId)` rows with `[read|write|admin]`, `resourceId="*"` for org-wide, leaf-inherits-parent (deployment/domain/service → project). One resolver (`lib/permission.ts`); denials throw **404 not 403** (IDOR-safe). Scoped PATs and OAuth-MCP tokens are enforced through the **same** grant model. otterdeploy has org-wide roles only.
_Files: `packages/db/src/schema/resource-grant.ts`, `apps/api/src/lib/permission.ts`._

**6. Backup breadth + the FK model that fixes otterdeploy's orphan bug.** _Directly copyable._
- **Multi-engine producers** (auto-detected from image regex): Postgres, MySQL/MariaDB/Percona, MongoDB, Redis — all **hot/app-consistent** dumps via container exec, with engine-specific restore, plus a custom-command escape hatch and a universal volume-tar fallback.
- **Four destination backends**: S3-compatible (~8 providers via one adapter, multipart + presign), SFTP, reuse-a-deploy-server, local disk.
- **The referential fix for otterdeploy's known orphan-schedule bug:** real FKs — policy→service is `ON DELETE CASCADE` (no orphan), policy→destination is `ON DELETE RESTRICT` (can't delete a destination with active policies), `backup_run` FKs `ON DELETE SET NULL` (history outlives schedule). This is exactly the model otterdeploy's jsonb-sources design is missing. **Copy this directly.**
- Two-phase restore (prepare/apply) with sha256 verification + constant-time confirmation token; two retention dimensions (count AND days) + per-run protection lock; four trigger types including **pre-deploy rollback snapshots**.
_Files: `packages/adapters/src/backup/**`, `packages/db/src/schema/backup.ts`, `apps/api/src/modules/backups/**`._

**7. Orphaned-resource GC.** An `orphaned_resource` table + periodic sweep: when a project is force-deleted while its server is unreachable, leaked containers/images/volumes/networks are recorded (intentionally FK-less) and a GC job probes the server until reachable, then destroys idempotently. Complements #6 for otterdeploy's broader orphan problem.
_Files: `packages/db/src/schema/orphaned-resource.ts`._

**8. Deploy-engine depth.** Beyond otterdeploy's current pipeline: **git-strategy rollback** (re-clone + rebuild at a past SHA using captured config/env, alongside snapshot rollback) with **auto-archive on every deploy** + retention + pinning; **zero-downtime overlap** deploy (activate → health-gate → route-swap → deactivate-old-last, auto-revert on pre-swap failure); **smart partial redeploy** (`targetServiceIds`) and **env-only refresh** (recreate container with new env, no rebuild); **GitHub-tarball clone-free source fetch** (no git/history/`.git` on target); and a **Dockerfile→shell workspace compiler** that replays multi-stage builds inside a VM without a Docker daemon.
_Files: `packages/adapters/src/runtime/{deploy-pipeline,bare,source-tarball}.ts`, `dockerfile/compiler.ts`, `apps/api/src/modules/deployments/rollback/rollback-orchestrator.ts`, `compose/pipeline.ts`._

**9. GitHub App depth.** otterdeploy already has a GitHub App install + webhook + builder (closer than expected). Depth to close: **monorepo-aware per-service change routing** (deploy only services whose `rootDirectory` matches changed files; force-all on root-config change), **per-project HMAC webhook-secret verification**, **check-run status reporting**, and a **gh-CLI-vs-App source abstraction** for self-hosted mode.
_Files: `apps/api/src/modules/github/**`, `webhook-changed-files.ts`._

**10. In-browser terminals with ticket-auth.** Two PTY-over-WebSocket surfaces (SSH into a server host; docker-exec/cloud-shell into a service container) with a **two-phase single-use ticket handshake** (auth'd POST mints an opaque token passed via `Sec-WebSocket-Protocol`, consumed once, replay-proof), origin allowlist, per-user session caps, full audit, and **session park/resume**. otterdeploy has a terminal router — compare the ticket-auth + resume design.
_Files: `apps/api/src/modules/{terminal,service-terminal}/`._

**11. Server-to-server / team-mode migration.** Reversible relocation of a whole single-user instance to a remote VPS / Openship Cloud / tunnel, with journaled exactly-once DB restore (`execJournaled`), `stripEncrypted` secret handling, preflight, migration lock, and 30-day switch-back grace; plus passphrase-sealed offline export/import bundles.
_Files: `apps/api/src/modules/system/migration/**`, `system/data-transfer/`._

### Tier 3 — Quick wins / smaller ideas

- **In-proxy analytics** — per-domain per-minute request/bandwidth/response-time counters + GeoIP breakdown + a 1000-entry ring buffer + SSE live-log tail, compiled into OpenResty via Lua shared-dict (no Redis). otterdeploy could get similar via Caddy logs, but the in-proxy per-minute aggregation + GeoIP is a net-new idea. _`packages/adapters/src/infra/lua/site_logger.lua`._
- **Geo-whitelisted rate limiting** as a first-class managed proxy snippet (`geo $whitelist` + `limit_req_zone`, CIDR whitelist, validate-and-rollback). _`infra/nginx.ts:516-672`._
- **Generic tunneling primitive** to expose a behind-NAT instance / dev server at a public URL (provider abstraction: Oblien implemented; ngrok + cloudflared are stubs). A real cloudflared/ngrok implementation would leapfrog openship, which only self-exposes its own dashboard today. _`apps/api/src/modules/tunneling/**`._
- **Configurable audit retention** (default 90d, org-overridable up to 5y) + daily prune cron; **audit → notification fan-out** with 4 channels (email, webhook, in_app, slack) where the outbound webhook channel is **HMAC-SHA256 signed**. _`lib/audit.ts`, `modules/notifications/`._
- **Sliding-window-counter rate limiter** with Redis-Lua-or-in-memory backend and fail-open, 9 named per-ip/user/org policies wired declaratively per route. _`lib/rate-limit/`._
- **Marketing/docs site** (`apps/web`): fumadocs portal with cli/api/**mcp** reference pages + `llms.txt`/`llms-full.txt` for LLM ingestion. Compare against otterdeploy's `www`.
- **Framework-detecting deploy wizard** UI (auto-detect stack → compose service graph → monorepo app discovery → env editor → target picker → live SSE build console).

---

## Recommended sequencing

1. **Copy now (low effort, high certainty):** the backup FK model + orphaned-resource GC (#6, #7) — fixes a known otterdeploy bug with a proven design.
2. **Prioritize (high strategic leverage):** MCP server (#1) — the auto-generate-from-contracts pattern should be cheap on oRPC.
3. **Close depth gaps opportunistically:** GitHub App routing/check-runs (#9), git-strategy rollback + partial redeploy (#8), per-resource RBAC (#5).
4. **Decide deliberately (big commitments):** built-in mail server (#2), desktop app (#3), managed-SaaS gateway pattern (#4).
5. **Leapfrog opportunities** (openship is weak/stubbed here): PR-based ephemeral previews (openship has none — branch-only), real tunneling providers, and mail alias/catch-all/forwarding admin UI.
