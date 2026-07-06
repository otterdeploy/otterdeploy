# Cutting a release

The platform self-updater (`packages/api/src/routers/system/`) is a
semver/GitHub-Release updater: it reads the running install's pinned
`OTTERDEPLOY_VERSION`, compares it to the repo's `releases/latest`, and — on
apply — pins the new tag in `.env` and `compose pull`s it. All of that only
works if every release exists as **three things with the same name**: a git
tag, a GitHub Release, and immutable image tags in GHCR. One command produces
all three:

```sh
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/images.yml` picks up the tag push and:

1. builds `server` and `caddy` for amd64+arm64 and pushes
   `ghcr.io/<owner>/{server,caddy}:v0.1.0` (a tag build does **not** move
   `:latest` — that tag tracks `main`),
2. after both manifests exist, publishes the GitHub Release with
   auto-generated notes (`--generate-notes`, from merged PRs since the last
   tag). The ordering matters: the moment the updater sees a new
   `releases/latest`, the images it will pull are already in the registry.

Prerelease tags (`v0.1.0-rc.1`) are published as GitHub *prereleases*, which
`releases/latest` ignores — installs on the stable channel never see them.

## How installs pick versions up

- **New installs** — `scripts/install.sh` resolves `releases/latest` at
  install time and writes the pinned tag into `.env` (fallback order: explicit
  `OTTERDEPLOY_VERSION` env → latest release → existing `.env` pin →
  `latest`).
- **Existing installs** (including old `:latest` installs) — the in-app
  updater badges as soon as `releases/latest` is newer than the pin;
  `compare.ts` sorts an unparseable current (`latest`, `dev`) *older* than any
  real release, so a `:latest` install migrates itself to a pinned semver on
  its first apply. `install.sh update` does the same from the CLI.

## Versioning process

There is no changesets/release-please automation: the deployable unit is the
whole platform (one version, fixed across the monorepo), not published npm
packages. Pick the next `vX.Y.Z` by hand, tag, push. Release notes come from
GitHub's PR-based note generation — write PR titles accordingly.
