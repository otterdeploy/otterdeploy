# otterdeploy CLI

Deploy and operate [otterdeploy](https://github.com/otterdeploy/otterdeploy)
projects from the terminal: projects, services, databases, domains,
deployments, logs, backups, and more, over the same typed API as the dashboard.

## Install

```bash
npm install -g @otterdeploy/cli
# or: bun add -g @otterdeploy/cli
```

Runs on Node ≥20 or Bun, on Windows, macOS, and Linux.

**Bun-only machines (no Node installed):** `bun add -g` symlinks the binary and
lets the OS run its `#!/usr/bin/env node` shebang, which needs Node. If you have
only Bun, run it with `bunx` instead. It executes under Bun and needs no Node:

```bash
bunx @otterdeploy/cli whoami
```

### `otd`, the short alias

Installing provides two commands for the same binary: `otterdeploy` and the
three-letter `otd`. They are interchangeable:

```bash
otd status
otterdeploy status   # identical
```

Help text and error hints echo back whichever name you typed, so anything the
CLI suggests can be copy-pasted as-is.

There is deliberately no `od` alias: `od` is the POSIX octal-dump utility
(`/usr/bin/od`) on every macOS and Linux machine, and a global npm bin directory
usually comes before `/usr/bin` on `PATH`, so claiming it would shadow a
standard tool for everything else running in that shell.

## Quick start

```bash
otd login https://deploy.example.com   # browser device-code login
otd up                                 # scaffold + deploy a project
otd deploy --wait                      # deploy and block until healthy (CI-friendly)
otd logs web                           # tail a service's logs
```

For CI, set `OTTERDEPLOY_URL` and `OTTERDEPLOY_TOKEN` (create a key with
`otd tokens create`) to skip the browser flow.

## Output

Commands are grouped by task. Run `otd --help` to see the groups, and
`otd <command> --help` for one command's options and worked examples.

State is reported with a consistent glyph plus colour, so it stays readable when
colour is unavailable:

| Glyph | Meaning                                            |
| ----- | -------------------------------------------------- |
| `●`   | live: running, valid, succeeded, pointed, ready    |
| `○`   | not yet: pending, queued, draft, unpointed         |
| `◐`   | in flight: building, starting, obtaining, draining |
| `△`   | impaired: degraded, proxied, denied                |
| `✗`   | failed: crashed, invalid, down                     |
| `·`   | retired: superseded, removed                       |

Conventions worth knowing:

- **Results go to stdout, diagnostics to stderr.** `otd deployments web --json | jq`
  and `otd export > stack.yml` stay clean even when the command also warns.
- **Piped output is plain.** Colour and formatting are dropped when stdout is not
  a terminal. `otd env list --service web > .env` writes real `KEY=value` lines,
  and `otd db url postgres` keeps its bare shape for `$(...)` capture.
- **`NO_COLOR` and `--no-color`** are honoured; `FORCE_COLOR=1` keeps colour in
  CI logs. Depth degrades from 24-bit through 256-colour to 16-colour by `TERM`.
- **`OTTERDEPLOY_ASCII=1`** swaps the box-drawing and geometric glyphs for ASCII.

## Docs

Full command reference: <https://github.com/otterdeploy/otterdeploy/tree/main/apps/cli>.
Run `otd <command> --help` for any command, and `otd completions <bash|zsh|fish>`
to install shell completions (generated for whichever name you invoke).
