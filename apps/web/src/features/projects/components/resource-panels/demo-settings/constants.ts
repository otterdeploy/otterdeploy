/**
 * Static catalog for the demo Settings tab — section nav labels plus
 * the builder + deploy-strategy radio groups. Pure data; no runtime
 * side effects. When the real settings ship these can either move
 * back into a richer engine catalog or get deleted alongside the demo.
 */

export const SETTINGS_SECTIONS = [
  "Source",
  "Build",
  "Health",
  "Resources",
  "Networking",
  "Scale",
  "Deploy",
  "Feature flags",
  "Danger zone",
] as const;

export const BUILDERS = [
  {
    id: "railpack",
    name: "Railpack",
    sub: "Auto-detect Node, Python, Go, Rust, Ruby, Elixir",
  },
  {
    id: "dockerfile",
    name: "Dockerfile",
    sub: "Use the Dockerfile in the repo",
  },
  { id: "nixpacks", name: "Nixpacks", sub: "Reproducible builds via Nix" },
  {
    id: "compose",
    name: "docker-compose",
    sub: "Pull a service from the compose file",
  },
] as const;

export const DEPLOY_STRATEGIES = [
  {
    id: "rolling",
    name: "Rolling",
    sub: "Replace replicas N at a time. Default.",
  },
  {
    id: "bluegreen",
    name: "Blue / green",
    sub: "Spin up new fleet, switch traffic, drain old.",
  },
  {
    id: "canary",
    name: "Canary",
    sub: "Send % of traffic to new version, ramp.",
  },
  {
    id: "recreate",
    name: "Recreate",
    sub: "Stop all replicas, start new. Has downtime.",
  },
] as const;
