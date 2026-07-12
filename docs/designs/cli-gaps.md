# CLI gap closure — `otterdeploy` (apps/cli)

Started as an audit (2026-07-11): the CLI shipped 14 commands touching 2 of ~20
API routers, with real bugs and a fully-open `/pty` shell. This document records
what was closed. The command surface is now 33 commands across the full API.

## Bugs fixed

- **`writeConfig` dropped `composes`** (data loss): `pull`/`add`/`up` rewrote the
  config without compose stacks, so the next deploy planned their deletion. Now
  carried through; regression test in `config-file.test.ts`. `writeConfig` also
  now validates against `manifestSchema` before persisting, so an invalid
  resource name can't produce an unloadable config.
- **No error handling**: every command now runs inside one boundary
  (`lib/errors.ts`) that maps oRPC/zod/network errors to a friendly line + exit
  code. A stale config-file token triggers an in-place device re-login and one
  retry; env tokens and non-TTY fall through with guidance.
- **No org selection**: added `org list` / `org use`; `whoami` shows the active
  org and works for `otter_` API-key actors.
- **`status --json`** emitted a placeholder string — now real drift JSON.
- **Version** was hardcoded `0.0.0` — now sourced from `package.json`.

## New commands (all backed by existing API procedures)

- Lifecycle: `remove`, `open`, `project delete`, `add compose`, `add service
  --repo/--branch/--env/--domain`.
- Day-2: `restart`, `rollback`, `build`, `deployments`, `exec` (interactive
  shell), `domains`, project-scoped `env --shared`, `environments`.
- Data: `db url` / `db creds` (ephemeral credentials), `backups`.
- Platform/observability: `metrics`, `audit`, `edge`, `platform`, `tokens
  create` (CI keys), `completions`.

## `deploy --wait` (the CI gate)

`deploy`/`sync`/`up`/`build` gained `--wait` (+ `--timeout`), which blocks until
every changed service converges and exits non-zero on failure. The convergence
signal is dual: git builds/redeploys are followed via their `deployment` row;
**image services get no deployment row**, so they're followed via the runtime
task rollup (`running | building | error`). E2E-proven: success → exit 0, a
crash-looping container → non-zero with the failing reason. `logs` gained
`--build`, `--no-follow`, and `--since` (with a small server-side `follow`/`since`
addition to `resource-logs.ts`).

## Security (server-side)

- **`docker.*` router** was `publicProcedure` (unauthenticated host enumeration).
  Now `requirePermission({ platform: ["read"] })` — the same gate as `system.*`
  host inspection.
- **`/pty` WebSocket** had no auth: `?host=1` was an open host shell and
  `?container=<id>` exec'd into any container cross-org. Now authenticated on the
  upgrade (cookie or `token` query param → session/API-key), org-scoped for
  containers, and the host shell requires a real session with `platform:update`.

## Packaging & DX

- `package.json` → `0.1.0`; `bun build --compile` binaries per platform
  (`scripts/compile-all.ts`) + a tag-triggered release workflow
  (`.github/workflows/cli-release.yml`). Standalone binary verified.
- Shell completions (`bash`/`zsh`/`fish`, generated from the live command tree),
  `NO_COLOR`/`--no-color`, `pull` overwrite confirmation.
- Tests: `apps/cli` now has a vitest suite (config round-trip incl. composes,
  dotenv/pair parsing, error mapping, wait-phase logic, completion tree).
- Docs: real getting-started + a `/docs/cli` overview and full command reference.

## Verification

Typecheck (cli/api/server/www all clean; the one failing package, `web`, fails on
a pre-existing vite-config type error byte-identical to `main`), lint + format
clean on all changed files, all test suites pass (api 271, cli 29, web 26).
E2E-exercised ~24 commands against a live control plane, including the full
create → deploy → observe → delete lifecycle. A 6-dimension adversarial review
found 12 real defects (0 false positives); all 12 are fixed and re-verified.
