/**
 * Worked examples for `--help`.
 *
 * citty's `CommandMeta` has no slot for examples, and augmenting a dependency's
 * type to add one would put help copy inside every command file. Keeping it in
 * one keyed registry means the whole CLI's teaching material can be read — and
 * reviewed for tone and coverage — in a single pass.
 *
 * Rules for what earns an example: the flag combination is non-obvious, the
 * command is destructive, or the argument shape is easy to get wrong. Commands
 * whose usage line already says everything (`logout`, `whoami`) get none —
 * padding help with restatements of the signature trains people to skip it.
 *
 * Every `run` omits the bin name; the renderer prefixes whichever one the user
 * typed. Flags here are kept in sync with the command definitions by
 * help-content.test.ts, which fails if an example names a flag that no longer
 * exists.
 */

export interface Example {
  /** Why you would run this, in lower case, no trailing period. */
  note: string;
  /** The command minus the bin name. */
  run: string;
}

/** Key for a command path: `["domains", "add"]` → `"domains add"`. */
export function exampleKey(path: string[]): string {
  return path.join(" ");
}

export const EXAMPLES: Record<string, Example[]> = {
  init: [
    { note: "scaffold a config and link a new project", run: "init --name Storefront" },
    { note: "write YAML instead of the default", run: "init --format yaml" },
  ],
  up: [
    { note: "scaffold if needed, then deploy in one step", run: "up" },
    { note: "block until every resource is healthy", run: "up --wait" },
  ],
  deploy: [
    { note: "show what would change without writing", run: "deploy --dry-run" },
    { note: "deploy a specific environment and wait", run: "deploy --env staging --wait" },
    { note: "non-interactive, for CI", run: "deploy --yes --json" },
  ],
  sync: [
    { note: "review the diff before applying", run: "sync --preview" },
    { note: "apply with a longer deploy timeout", run: "sync --wait --timeout 600" },
  ],
  status: [
    { note: "check for drift; exits non-zero when it finds any", run: "status" },
    { note: "drift for one environment, machine-readable", run: "status --env prod --json" },
  ],
  logs: [
    { note: "follow a service's runtime logs", run: "logs web" },
    { note: "replay the last hour and exit", run: "logs web --since 1h --no-follow" },
    { note: "watch the build pipeline instead", run: "logs web --build" },
  ],
  deployments: [
    { note: "recent deploy history for a service", run: "deployments web" },
    { note: "just the last five", run: "deployments web --limit 5" },
  ],
  rollback: [
    { note: "roll back to the previous deployment", run: "rollback web" },
    { note: "roll back to a specific deployment", run: "rollback web dpl_01hxk2" },
  ],
  exec: [
    { note: "open a shell in a running container", run: "exec web" },
    { note: "target one replica", run: "exec web --replica 2" },
  ],
  restart: [
    { note: "restart with the current image and env", run: "restart web" },
    { note: "roll a database the same way", run: "restart postgres" },
  ],
  build: [{ note: "build from the bound branch and wait", run: "build web --wait" }],
  redeploy: [{ note: "rebuild from the head of the bound branch", run: "redeploy web" }],
  metrics: [{ note: "cpu, memory and network for one resource", run: "metrics web" }],
  open: [{ note: "open a service in the dashboard", run: "open web" }],
  export: [
    { note: "render the project as a compose file", run: "export --out stack.yml" },
    { note: "pipe it somewhere else", run: "export" },
  ],
  pull: [{ note: "overwrite the local config from the server", run: "pull" }],

  login: [
    { note: "sign in to a control plane", run: "login https://otter.example.com" },
    { note: "re-use the URL from a previous login", run: "login" },
  ],

  "add service": [
    { note: "add a service from a container image", run: "add service web --image nginx:alpine" },
    { note: "add a service built from this git repo", run: "add service api --git" },
    { note: "add a service deployed from local files", run: "add service site --upload" },
  ],
  "add database": [
    { note: "add a managed database", run: "add database db --engine postgres" },
    {
      note: "engines: postgres, redis, mariadb, mongodb, clickhouse",
      run: "add database cache --engine redis",
    },
  ],
  "add compose": [
    { note: "adopt a local compose file", run: "add compose stack --file docker-compose.yml" },
    {
      note: "track a compose file in a git repo",
      run: "add compose stack --git-url https://github.com/me/app --compose-path deploy/compose.yml",
    },
  ],

  "domains list": [
    { note: "domains, DNS and cert state for a service", run: "domains list --service web" },
  ],
  "domains add": [
    { note: "attach a custom domain", run: "domains add app.example.com --service web" },
  ],
  "domains recheck": [
    {
      note: "re-run the DNS check after updating records",
      run: "domains recheck app.example.com --service web",
    },
  ],
  "domains remove": [
    {
      note: "detach a domain, skipping the prompt",
      run: "domains remove app.example.com --service web --yes",
    },
  ],

  "env list": [
    { note: "a service's variables", run: "env list --service web" },
    { note: "variables shared across the project", run: "env list --shared" },
  ],
  "env set": [
    {
      note: "set one variable on a service",
      run: "env set --service web DATABASE_URL=postgres://…",
    },
    { note: "set a project-wide variable", run: "env set --shared LOG_LEVEL=debug" },
  ],
  "env import": [
    { note: "replace a service's variables from a file", run: "env import .env --service web" },
    { note: "merge instead of replacing", run: "env import .env --service web --merge" },
  ],
  "env unset": [{ note: "remove a variable", run: "env unset --service web LOG_LEVEL" }],

  "volume list": [{ note: "persistent volumes on a service", run: "volume list --service web" }],
  "volume add": [
    {
      note: "mount a persistent volume",
      run: "volume add --service web --mount-path /var/lib/data",
    },
  ],

  "db url": [
    { note: "print a connection URL", run: "db url postgres" },
    { note: "issue a short-lived credential instead", run: "db url postgres --ephemeral" },
  ],
  "db creds list": [{ note: "list issued credentials", run: "db creds list postgres" }],

  "backups run": [
    { note: "back up a database now", run: "backups run postgres" },
    {
      note: "send it to a named destination",
      run: "backups run postgres --destination s3-primary",
    },
  ],
  "backups list": [
    { note: "recent backups for a database", run: "backups list --database postgres" },
  ],
  "backups restore": [
    {
      note: "restore a backup — requires the database name to confirm",
      run: "backups restore bkp_01hxk2 --confirm postgres",
    },
  ],

  "project list": [{ note: "projects in the active organization", run: "project list" }],
  "project create": [
    { note: "create a project", run: "project create --name Storefront --slug storefront" },
  ],
  "org use": [{ note: "switch the active organization", run: "org use otter-labs" }],
  "tokens create": [
    { note: "create an API key for CI", run: "tokens create --name ci --expires 90d" },
  ],
  "environments create": [{ note: "add an environment", run: "environments create staging" }],

  audit: [
    { note: "recent organization audit events", run: "audit" },
    { note: "only failures, filtered by action", run: "audit --failed --action service.deploy" },
  ],
  "edge tail": [{ note: "follow Caddy access logs", run: "edge tail" }],
  "platform health": [{ note: "host memory, disk and docker usage", run: "platform health" }],
  "platform update check": [
    { note: "see whether a platform update is available", run: "platform update check" },
  ],
  "platform update apply": [
    { note: "apply the update after reviewing it", run: "platform update apply" },
  ],

  completions: [
    {
      note: "enable tab completion in zsh",
      run: "completions zsh > ~/.otterdeploy-completion.zsh",
    },
    { note: "print the bash script", run: "completions bash" },
  ],
};
