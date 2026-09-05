# Authoring a template `.env.schema`

One file per template, `<templateId>.env.schema`, in `@env-spec` format (what
[varlock](https://varlock.dev) reads). It is the single source of truth for the
template's environment: the CI gate checks it against the compose file, the
variables editors get autocomplete + descriptions + shape checks from it, and
`@docs` links tell the operator where a value comes from.

## Where the truth comes from

**From what the code READS, at the version the template pins.** Not from the
docs page, not from `.env.example`, not from memory. Postiz's `.env.example`
omitted nine variables its providers actually read.

1. Find the pinned version in the template's compose (`image: foo/bar:1.2.3`).
   A floating tag (`latest`, `main`, `stable`) means: resolve what it points
   at today, research that, and record the resolved version in the header.
2. Get that version's source. `curl -L https://github.com/<org>/<repo>/archive/refs/tags/<tag>.tar.gz`
   into `/tmp`. If the project does not publish source (closed image), fall
   back to its documented configuration reference and say so in the header.
3. Grep for environment reads in that language:
   - Node/TS: `process\.env\.[A-Z0-9_]+`, `env\(["']`, `getenv`
   - Go: `os\.Getenv\(`, `os\.LookupEnv\(`, `viper\.`, `envconfig`, struct tags `env:"`
   - Python: `os\.environ`, `os\.getenv\(`, `env\(`, `config\(`, django-environ
   - Rust: `env::var\(`, `std::env`, `#[clap(env`
   - PHP: `getenv\(`, `env\(`, `$_ENV`
   - Java/Kotlin: `System\.getenv\(`, `@Value("${`
   - Ruby: `ENV\[`, `ENV\.fetch`
   - Elixir: `System\.get_env\(`
4. Cross-check against `.env.example`, the docs reference, and upstream's own
   docker-compose. Anything the code reads that the docs omit is worth a
   comment; anything the docs list that the code never reads does NOT go in.

## The file

```
# <App> <version> — environment schema (@env-spec / varlock format).
# Source: <where the vars came from, e.g. "grep of process.env across apps/ at v2.23.0">
# <Anything the docs got wrong, in one or two lines.>

# @defaultSensitive=false @defaultRequired=infer
# @docs("<App> configuration reference", <verified URL>)
# ---

# ─── Core ─────────────────────────
...
```

- `# @defaultSensitive=false` so only `@sensitive` items are masked.
- `# @defaultRequired=infer` and then mark `@required` explicitly. Never rely
  on infer alone.
- Group by what the operator is doing (Core / Bundled services / Storage /
  Email / Auth / Integrations / Misc). A comment block above an item is its
  description in the editor: one or two sentences on what it does at THIS
  version and what breaks without it.

## Ownership is the value

```
MAIN_URL=${{stack.app.PUBLIC_URL}}          platform-owned: derived, never typed
DATABASE_URL=postgres://u:${PW}@${{stack.db.HOST}}:5432/x
LINKEDIN_CLIENT_ID=                        operator-owned: must be supplied
API_LIMIT=30                               defaulted: operator may override
```

A value otterdeploy can answer for itself (the service's own public URL, a
sibling's hostname, a generated secret) is written as the SAME ref the compose
uses — copy it from the template's compose, character for character. The gate
fails on any mismatch. A literal there is the bug this layer exists to stop.

Every key the compose sets on ANY service (including the bundled Postgres,
Redis, Temporal) must be declared, with the value the compose gives it.

## Decorators

| decorator | use |
|---|---|
| `@required` | the app refuses to start, or the feature is dead, without it |
| `@sensitive` | credentials, tokens, keys, DSNs, passwords |
| `@type=url` `email` `number` `port` `boolean` | the editor checks the shape |
| `@type=enum(a, b, c)` | closed set |
| `@type=string(minLength=N, startsWith=X, matches=/re/)` | constraints; a regex must be a `/…/` literal |
| `@docs("label", url)` | the label MUST be quoted; the URL MUST answer 2xx — verify with curl |

**Attach every `@docs` to an item, never to a section ruler.** A `@docs` in a
comment block that is separated from the next key by a blank line is dropped by
the env-spec projection: it never reaches the editor, and `--links` never checks
it, so it rots silently. Put it in the comment block directly above the
section's first key instead. (Several schemas were authored with ruler-level
`@docs` before this was understood — `uptime-kuma.env.schema` still has two that
are being dropped.)

Do not invent types outside that table; the interpreter ignores unknown ones
and the editor then shows no check, which is honest. Do not use `@example`.

## An empty value never reaches the container

Declaring an optional key with an empty value is safe, and is the house style.
The schema is an EDITOR layer, not a runtime one: `ENV_SCHEMAS` is consumed
only by `env-catalog`, whose every consumer is a UI component (key
autocomplete, descriptions, shape validation). Nothing in `packages/api` or
`packages/jobs` reads it, and the new-resource wizard passes suggestions to
autocomplete and validators, never auto-applying them to the resource.

So what reaches a running container is exactly: what the compose sets, plus
what the operator actually typed. This matters because several apps treat a
PRESENT-but-blank variable as an override to zero/empty (LiveKit's YAML
scalars are one: a blank `LIVEKIT_RTC_TCP_PORT` zeroes the port rather than
falling back to the config file). Documenting such a key with an empty value
does NOT trigger that behaviour, so do not pre-fill it with an effective value
out of caution: describe the hazard in the comment instead.

## Rules

- Empty value for anything the operator supplies. Never a placeholder, never
  an example secret.
- Every `@docs` URL verified live (`curl -sI -o /dev/null -w '%{http_code}'`).
  Prefer the project's own docs page for that feature; a provider's developer
  console is fine for OAuth apps. No link is better than a guessed one.
- Single-line values only.
- Do not reference other templates' schemas; each stands alone.
- Do not edit `index.ts`, do not run `bun run format` / `lint`, do not run any
  `git` command. Create only `<templateId>.env.schema`.

## Verify

```
cd apps/web
bun scripts/check-env-schema.ts <templateId> --images <app-image-repo> --links
```

`--images` is the app image repo(s), tagless and lowercase, with `docker.io/`
and `library/` stripped: `ghcr.io/gitroomhq/postiz-app`, `n8nio/n8n`,
`ghost`. Usually the app image alone; bundled Postgres/Redis are covered by
the database catalog. It must be an image the compose actually runs.

PASS means: parses, every compose key declared, every platform-owned value
matches the compose, every prompted key declared, images honest, links live.
Iterate until PASS. Then report: version researched, item count, images, and
anything you were unsure about.
