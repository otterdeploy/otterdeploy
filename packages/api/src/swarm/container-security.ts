/**
 * od-5j8.23 — shared Linux-capability / process-privilege defaults for every
 * swarm `ContainerSpec` the platform builds: tenant "service" workloads
 * (`./internals.ts`, image + git + compose sub-services all funnel through
 * `routers/service/spec.ts#buildSwarmSpec`) and managed databases
 * (`./database-internals.ts`). One policy module, applied consistently by
 * both drivers, instead of two ContainerSpec builders that can silently
 * drift apart on what a tenant workload is allowed to do.
 *
 * BASELINE CHOSEN: `CapabilityDrop: ["ALL"]` then explicitly re-add Docker
 * Engine's own out-of-the-box default capability set (moby's
 * `oci/caps/defaults.go`) MINUS `NET_RAW`.
 *
 * Why re-add the Docker default set instead of dropping to nothing: the
 * official postgres/mysql/mongo/redis images (and a large fraction of the
 * wider ecosystem) start their entrypoint AS ROOT, `chown` the data/volume
 * path to a low-privilege user, then exec via `gosu`/`su-exec` — that dance
 * needs CHOWN, DAC_OVERRIDE, SETUID and SETGID to be available *before* the
 * process drops privileges. A bare `CapabilityDrop: ["ALL"]` with no re-add
 * breaks that entrypoint outright (`chown: Operation not permitted`) on the
 * very next redeploy of an already-running service — exactly the outcome
 * this issue's "must not break existing running services" constraint rules
 * out. Re-adding Docker's own default set keeps every image that works
 * today working identically tomorrow: for the overwhelming majority of
 * workloads (nothing on the node currently uses NET_RAW — see below) this
 * change is a no-op relative to un-hardened Docker.
 *
 * Why still drop `NET_RAW` specifically: it's the one default capability
 * with a concrete multi-tenant blast radius on this platform — a container
 * with NET_RAW can craft raw/ICMP sockets and, on a shared project overlay
 * network, sniff or spoof traffic between sibling services. It's needed
 * only by raw-socket tooling (ping, tcpdump, custom ARP/ICMP utilities) —
 * essentially never by an application server, database, or job worker — so
 * removing it is close to zero-risk for real workloads while closing a real
 * cross-tenant sniffing/spoofing vector.
 *
 * `CapabilityDrop: ["ALL"]` + an explicit allow-list also means a *future*
 * Docker Engine default-capability addition does not silently reach tenant
 * containers — this module's list is the only source of truth going
 * forward, not "whatever the installed daemon happens to default to."
 */

export const DEFAULT_CAP_DROP = ["ALL"];

/** Docker Engine's own default capability set, minus `NET_RAW` — see module
 *  doc for the rationale. */
export const DEFAULT_CAP_ADD = [
  "CHOWN",
  "DAC_OVERRIDE",
  "FSETID",
  "FOWNER",
  "MKNOD",
  "SETGID",
  "SETUID",
  "SETFCAP",
  "SETPCAP",
  "NET_BIND_SERVICE",
  "SYS_CHROOT",
  "KILL",
  "AUDIT_WRITE",
];

/**
 * Bounds live PIDs inside a container so a fork bomb — an accidental crash
 * loop that spawns subprocesses, or a malicious payload — can't starve the
 * node. Generous enough that no legitimate workload observed on this
 * platform should ever approach it (a connection-per-process database, a
 * supervisor + worker pool, a dev server with a file-watcher subprocess are
 * all a small fraction of this). A service that genuinely needs more (or
 * none) sets `security.pidsLimit` explicitly — see `resolvePidsLimit`.
 */
export const DEFAULT_PIDS_LIMIT = 2048;

export interface ContainerSecurityOverrides {
  /** Defaults to `DEFAULT_CAP_DROP` (`["ALL"]`). */
  capDrop?: string[];
  /** Defaults to `DEFAULT_CAP_ADD`. Every entry here is a deliberate,
   *  auditable escalation over the platform baseline — nothing populates
   *  this from raw tenant/compose input today (compose `cap_add` is
   *  rejected outright by `stack/compose/compatibility.ts` instead of
   *  silently granted). Reserved for a future explicit, admin-authorized
   *  override. */
  capAdd?: string[];
  /** Defaults to `true`. Blocks the container (and anything it execs) from
   *  gaining more privileges than its parent, e.g. via a setuid binary. */
  noNewPrivileges?: boolean;
  /** Defaults to `false`. Many existing images (databases, anything that
   *  writes logs/cache/tmp files onto its own image layer) need a writable
   *  rootfs; forcing this on by default would break already-running
   *  services outright. Opt-in per service. */
  readOnlyRootfs?: boolean;
}

/**
 * Mutates `containerSpec` in place with the platform's baseline hardening.
 * Every ContainerSpec the swarm drivers build must route through this so
 * the policy can't silently vary between the service driver and the
 * database driver.
 *
 * There is deliberately NO parameter for `Privileged` anywhere in this
 * module or its overrides type — the field doesn't exist here, so a
 * privileged container structurally cannot be requested through this path
 * (Docker Swarm's own ContainerSpec has no `Privileged` field at all — it's
 * a `docker run`/HostConfig-only concept, unsupported for swarm services).
 */
export function applyContainerSecurityDefaults(
  containerSpec: Record<string, unknown>,
  overrides?: ContainerSecurityOverrides,
): void {
  containerSpec.CapabilityDrop = overrides?.capDrop ?? DEFAULT_CAP_DROP;
  containerSpec.CapabilityAdd = overrides?.capAdd ?? DEFAULT_CAP_ADD;
  containerSpec.Privileges = {
    NoNewPrivileges: overrides?.noNewPrivileges ?? true,
    // Explicit rather than implicit: this is a no-op vs. Docker's own
    // default seccomp profile (applied automatically whenever `Seccomp` is
    // omitted), but stating it here makes the posture auditable and gives
    // the platform one place to change it later. AppArmor is intentionally
    // left unset — forcing a named profile would fail hard on any host
    // without AppArmor available (most non-Debian/Ubuntu distros), which
    // would break provisioning across a chunk of real deployments; the
    // daemon already applies its own AppArmor default when it's present.
    Seccomp: { Mode: "default" },
  };
  containerSpec.ReadOnly = overrides?.readOnlyRootfs ?? false;
}

/** `null` explicitly disables the PID ceiling for one service; `undefined`
 *  (the common case — nothing set) falls back to `DEFAULT_PIDS_LIMIT`. */
export function resolvePidsLimit(pidsLimit: number | null | undefined): number | undefined {
  if (pidsLimit === null) return undefined;
  return pidsLimit ?? DEFAULT_PIDS_LIMIT;
}
