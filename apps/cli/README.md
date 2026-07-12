# otterdeploy CLI

Deploy and operate [otterdeploy](https://github.com/otterdeploy/otterdeploy)
projects from the terminal — projects, services, databases, domains,
deployments, logs, backups, and more, over the same typed API as the dashboard.

## Install

```bash
npm install -g @otterdeploy/cli
# or: bun add -g @otterdeploy/cli
```

Runs on Node ≥20 or Bun, on Windows, macOS, and Linux.

**Bun-only machines (no Node installed):** `bun add -g` symlinks the binary and
lets the OS run its `#!/usr/bin/env node` shebang, which needs Node. If you have
only Bun, run it with `bunx` instead — it executes under Bun and needs no Node:

```bash
bunx @otterdeploy/cli whoami
```

## Quick start

```bash
otterdeploy login https://deploy.example.com   # browser device-code login
otterdeploy up                                 # scaffold + deploy a project
otterdeploy deploy --wait                       # deploy and block until healthy (CI-friendly)
otterdeploy logs web                            # tail a service's logs
```

For CI, set `OTTERDEPLOY_URL` and `OTTERDEPLOY_TOKEN` (create a key with
`otterdeploy tokens create`) to skip the browser flow.

## Docs

Full command reference: <https://github.com/otterdeploy/otterdeploy/tree/main/apps/cli>.
Run `otterdeploy <command> --help` for any command, and
`otterdeploy completions <bash|zsh|fish>` to install shell completions.
