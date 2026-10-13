/**
 * Exhaustive model check of the real planner: node loss, partitions, daemon
 * death with containers still running, restarts, fences and leases-style
 * independent message delivery, at small bounds.
 *
 * The world is two nodes: n1, whose link, daemon, incarnation and power the
 * environment controls, and n2, always healthy. Each configuration explores
 * one service with one slot: an exclusive one (`db`) or a shared one (`web`).
 * Messages are independent actions that may never happen: a grant or stop is
 * delivered only when the environment chooses to. Processes are physical
 * truth: a partitioned or crashed daemon leaves its containers running; only
 * a delivered stop, a restart's boot quarantine (exclusive grants only) or a
 * completed fence stops them. Every controller step runs `plan()` on a
 * snapshot of the control plane's knowledge and applies the actions with the
 * store's admission and release rules.
 *
 * Invariants: one non-released grant per exclusive slot; at most one running
 * exclusive process; a released grant is positively retired; a running copy
 * is never released (its reservation stays); one active shared grant plus at
 * most one start-first candidate. Edge checks: generations only rise, no new
 * exclusive generation while an earlier one lacks evidence, and no failover
 * before the policy delay from the node's last evidence. Three weakened
 * controllers (silence as a stop, revocation as a release, the delay ignored)
 * must each fail.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { GrantView, NodeView, Retirement, ServiceView, Snapshot } from "../model";

import { admit, mayRelease } from "../admission";
import { barrierRetires } from "../evidence";
import { type Action, plan } from "../plan";
import { T0, node, service, spec } from "./fixtures";
import { type Edge, type Model, check } from "./model-check";

const TICK = 10_000;
const TMAX = 6;
/** Generations per slot explored; a further admission is refused (the store may always refuse). */
const MAX_GEN = 3;
const DELAY_TICKS = 3;

type Svc = "db" | "web";
interface G {
  id: number;
  svc: Svc;
  node: "n1" | "n2";
  gen: number;
  inc: number;
  state: GrantView["state"];
  orphan: boolean;
  surge: boolean;
  revokedAt: number | null;
  stopReq: boolean;
  sentAt: number | null;
  delivered: boolean;
  running: boolean;
  /** Kept by a restarted node, frozen until the control plane confirms (exclusive). */
  paused: boolean;
  /** Reported as held by a restarted node. */
  held: boolean;
  /** Created by adopting a held attempt. */
  adopted: boolean;
  cert: boolean;
  evidence: "cert" | "fence" | "cancel" | "adoption" | "silence" | null;
}
interface S {
  t: number;
  power: boolean;
  daemon: boolean;
  link: boolean;
  /** The current session's first slot report has arrived. */
  reported: boolean;
  inc: number;
  last: number;
  fenceAt: number | null;
  fencedAt: number | null;
  home: string | null;
  grants: G[];
  next: number;
  high: { db: number; web: number };
}

interface Config {
  /** The one service explored: `db` (exclusive) or `web` (shared). */
  svc: Svc;
  dbPolicy: "reschedule" | "stay";
  fence: boolean;
  /** What a restarted daemon does with earlier-incarnation work: stop exclusive grants, or hold everything for the control plane. */
  restart: "quarantine" | "hold";
  mutant?: "silence-as-stop" | "revoke-as-release" | "delay-ignored" | "adopt-revoked";
}

const now = (s: S) => T0 + s.t * TICK;

function snapshotOf(s: S, cfg: Config): Snapshot {
  const n1Last = cfg.mutant === "delay-ignored" && !s.link ? now(s) - 31_000 : T0 + s.last * TICK;
  const nodes: NodeView[] = [
    node("n1", {
      incarnation: s.link ? `i${s.inc}` : null,
      connected: s.link,
      reported: s.reported,
      lastEvidenceAt: n1Last,
      fence: { adapter: "hetzner", enabled: cfg.fence },
      fencing: s.fenceAt !== null && s.fencedAt === null,
      ordinal: 1,
    }),
    // Smaller than n1, so the service starts on n1 and can fail over to n2.
    node("n2", {
      incarnation: "i1",
      lastEvidenceAt: now(s),
      ordinal: 2,
      allocatable: { nanoCpus: 2_000_000_000, memoryBytes: 2 * 1024 ** 3 },
    }),
  ];
  const dbSpec = spec("db", {
    lifecycle: {
      exclusive: true,
      failoverPolicy: cfg.dbPolicy,
      failoverDelayMs: DELAY_TICKS * TICK,
    },
  });
  const webSpec = spec("web", {
    lifecycle: { failoverPolicy: "reschedule", failoverDelayMs: DELAY_TICKS * TICK },
  });
  const services: ServiceView[] =
    cfg.svc === "db" ? [service(dbSpec, { homeNode: s.home })] : [service(webSpec)];
  const live = s.grants.filter((g) => g.state !== "released");
  const grants: GrantView[] = live.map((g) => view(g, s));
  const retirements: Retirement[] = [];
  for (const g of live) {
    if (g.cert)
      retirements.push({
        grantId: `g${g.id}`,
        evidenceId: `cert-${g.id}`,
        kind: "stop-certificate",
      });
    else if (g.node === "n1" && s.fencedAt !== null) {
      const barrier = {
        evidenceId: "fence",
        method: "provider-power-off" as const,
        adapter: "hetzner",
        nodeEpoch: 1,
        observedAtUnixMs: T0 + s.fencedAt * TICK,
      };
      const retires = barrierRetires(barrier, {
        nodeEpoch: 1,
        sentAt: g.sentAt === null ? null : T0 + g.sentAt * TICK,
        revoked: g.revokedAt !== null,
        revokedAt: g.revokedAt === null ? null : T0 + g.revokedAt * TICK,
      });
      if (retires && g.revokedAt !== null && s.fenceAt !== null && g.revokedAt <= s.fenceAt) {
        retirements.push({ grantId: `g${g.id}`, evidenceId: "fence", kind: "provider-power-off" });
      }
    }
  }
  return { now: now(s), nodes, services, grants, retirements };
}

function view(g: G, s: S): GrantView {
  return {
    grantId: `g${g.id}`,
    resourceId: g.svc,
    slotIndex: 0,
    generation: g.gen,
    nodeId: g.node,
    nodeEpoch: 1,
    incarnation: `i${g.inc}`,
    exclusive: g.svc === "db",
    specRevision: 1,
    state: g.state,
    orphan: g.orphan,
    surge: g.surge,
    revoked: g.revokedAt !== null,
    stopRequested: g.stopReq,
    sentAt: g.sentAt === null ? null : T0 + g.sentAt * TICK,
    runningSince: g.running ? T0 - 60_000 : null,
    failed: false,
    held:
      g.held && g.inc < s.inc && s.link
        ? { attemptId: `att-${g.svc}-${g.gen}`, paused: g.paused }
        : null,
  };
}

function apply(s: S, actions: Action[], cfg: Config, snap: Snapshot): void {
  const byId = (id: string) => s.grants.find((g) => `g${g.id}` === id);
  const retirementOf = (id: string) => snap.retirements.find((r) => r.grantId === id) ?? null;
  for (const a of actions) {
    if (a.kind === "release") {
      const g = byId(a.grantId);
      if (!g) continue;
      const ok = mayRelease(view(g, s), retirementOf(a.grantId));
      if (ok.isErr()) throw new Error(`planner released ${a.grantId} without evidence`);
      g.state = "released";
      g.evidence =
        ok.value === "cancel"
          ? "cancel"
          : retirementOf(a.grantId)?.kind === "stop-certificate"
            ? "cert"
            : "fence";
    } else if (a.kind === "issue") {
      const svc: Svc = a.resourceId === "db" ? "db" : "web";
      const slot = s.grants
        .filter((g) => g.svc === svc && g.state !== "released")
        .map((g) => view(g, s));
      const r = admit(
        { highWater: s.high[svc], grants: slot },
        { exclusive: a.exclusive, surge: a.surge },
      );
      if (r.isErr() || r.value > MAX_GEN) continue;
      const target = a.nodeId === "n1" ? "n1" : "n2";
      s.high[svc] = r.value;
      if (svc === "db" && cfg.dbPolicy === "stay" && s.home === null) s.home = target;
      s.grants.push({
        id: s.next++,
        svc,
        node: target,
        gen: r.value,
        inc: target === "n1" ? s.inc : 1,
        state: "granted",
        orphan: false,
        surge: a.surge,
        revokedAt: null,
        stopReq: false,
        sentAt: s.t,
        delivered: false,
        running: false,
        paused: false,
        held: false,
        adopted: false,
        cert: false,
        evidence: null,
      });
    } else if (a.kind === "adopt") {
      const g = byId(a.grantId);
      if (g) adopt(s, g);
    } else if (a.kind === "stop") {
      const g = byId(a.grantId);
      if (!g) continue;
      if (cfg.mutant === "adopt-revoked" && g.held && g.inc < s.inc && s.link) {
        adopt(s, g);
        continue;
      }
      g.stopReq = true;
      g.revokedAt ??= s.t;
      g.state = "stopping";
    } else if (a.kind === "revoke") {
      const g = byId(a.grantId);
      if (!g) continue;
      g.revokedAt ??= s.t;
      g.state = "unknown";
      if (cfg.mutant === "revoke-as-release") {
        g.state = "released";
        g.evidence = "silence";
      }
    } else if (a.kind === "orphan") {
      const g = byId(a.grantId);
      if (g) g.orphan = true;
    } else if (a.kind === "fence") {
      if (s.fenceAt === null) s.fenceAt = s.t;
    } else if (a.kind === "pending" && cfg.mutant === "silence-as-stop") {
      if (a.reason.code === "fence-required" || a.reason.code === "fencing") {
        for (const g of s.grants) {
          if (g.svc === "db" && g.state !== "released" && g.node === "n1") {
            g.state = "released";
            g.evidence = "silence";
          }
        }
      }
    }
  }
}

/**
 * The store's adoption: the old grant hands over and a new generation on the
 * same node takes the same container (same process) in one transaction.
 */
function adopt(s: S, g: G): void {
  g.state = "released";
  g.evidence = "adoption";
  s.high[g.svc] += 1;
  s.grants.push({
    ...g,
    id: s.next++,
    gen: s.high[g.svc],
    inc: s.inc,
    state: "granted",
    revokedAt: null,
    stopReq: false,
    sentAt: s.t,
    delivered: false,
    held: false,
    adopted: true,
    cert: false,
    evidence: null,
  });
  g.running = false;
  g.paused = false;
}

/**
 * Copy for the next transition. A grant released in an earlier step is
 * terminal (the invariants saw it released and stopped), so it is dropped and
 * the rest renumbered: states that differ only in history collapse into one.
 */
const clone = (s: S): S => {
  const kept = s.grants
    .filter((g) => g.state !== "released" || g.running || g.paused)
    .map((g, i) => ({ ...g, id: i + 1 }));
  return { ...s, high: { ...s.high }, grants: kept, next: kept.length + 1 };
};
const n1Answers = (s: S) => s.power && s.daemon && s.link;

function world(cfg: Config): Model<S> {
  return {
    initial: [
      {
        t: 0,
        power: true,
        daemon: true,
        link: true,
        reported: true,
        inc: 1,
        last: 0,
        fenceAt: null,
        fencedAt: null,
        home: null,
        grants: [],
        next: 1,
        high: { db: 0, web: 0 },
      },
    ],
    next(s) {
      const out: Edge<S>[] = [];
      const add = (action: string, f: (n: S) => void) => {
        const n = clone(s);
        f(n);
        out.push({ action, state: n });
      };
      add("controller-step", (n) => apply(n, plan(snapshotOf(n, cfg)), cfg, snapshotOf(n, cfg)));
      if (s.t < TMAX) {
        add("time-advances", (n) => {
          n.t++;
          if (n.link) n.last = n.t;
        });
      }
      if (n1Answers(s)) add("n1-partition", (n) => void (n.link = false));
      if (n1Answers(s) && !s.reported)
        add("n1-first-report-of-session", (n) => void (n.reported = true));
      if (s.power && s.daemon && !s.link) {
        add("n1-partition-heals", (n) => {
          n.link = true;
          n.reported = false;
          n.last = n.t;
        });
      }
      if (s.power && s.daemon) {
        add("n1-daemon-dies-containers-keep-running", (n) => {
          n.daemon = false;
          n.link = false;
        });
      }
      if (s.power && !s.daemon && s.inc < 2) {
        add("n1-daemon-restarts-boot-quarantine", (n) => {
          n.daemon = true;
          n.inc++;
          n.link = true;
          n.reported = false;
          n.last = n.t;
          for (const g of n.grants) {
            if (g.node !== "n1" || g.inc >= n.inc) continue;
            if (cfg.restart === "quarantine") {
              // Boot quarantine stops exclusive grants; shared ones keep running.
              if (g.svc === "db") g.running = false;
            } else {
              // An unrevoked exclusive grant is kept, frozen and reported as
              // held; shared grants keep running unheld.
              if (g.svc === "db" && g.running && g.revokedAt === null) {
                g.held = true;
                g.running = false;
                g.paused = true;
              }
            }
          }
        });
      }
      if (s.fenceAt !== null && s.fencedAt === null) {
        add("fence-completes-power-off", (n) => {
          n.fencedAt = n.t;
          n.power = false;
          n.daemon = false;
          n.link = false;
          for (const g of n.grants) {
            if (g.node === "n1") {
              g.running = false;
              g.paused = false;
            }
          }
        });
      }
      s.grants.forEach((g) => {
        const same = (n: S) => n.grants.find((x) => x.svc === g.svc && x.gen === g.gen);
        if (g.state === "released") return;
        const answers = g.node === "n2" || n1Answers(s);
        const nodeInc = g.node === "n2" ? 1 : s.inc;
        if (answers && !g.delivered && g.inc === nodeInc) {
          add(`deliver-grant-g${g.id}`, (n) => {
            const h = same(n);
            if (!h) return;
            h.delivered = true;
            // An adopting grant unfreezes the same container; any other starts one.
            if (h.revokedAt === null && (!h.adopted || h.paused)) h.running = true;
            h.paused = false;
          });
        }
        if (answers && g.stopReq && !g.cert) {
          add(`deliver-stop-g${g.id}`, (n) => {
            const h = same(n);
            if (!h) return;
            h.running = false;
            h.paused = false;
            h.cert = true;
          });
        }
      });
      return out;
    },
    invariants: [
      {
        id: "I1-one-live-exclusive-grant",
        test: (s) => s.grants.filter((g) => g.svc === "db" && g.state !== "released").length <= 1,
      },
      {
        id: "positive-retirement",
        test: (s) =>
          s.grants.every(
            (g) =>
              g.state !== "released" ||
              (!g.running &&
                !g.paused &&
                g.evidence !== "silence" &&
                (g.evidence !== "cancel" || g.sentAt === null)),
          ),
      },
      {
        id: "G-PROCESS",
        // A frozen (paused) container still holds its data: it counts.
        test: (s) => s.grants.filter((g) => g.svc === "db" && (g.running || g.paused)).length <= 1,
      },
      {
        id: "I5-running-copy-keeps-reservation",
        test: (s) => s.grants.every((g) => !(g.running || g.paused) || g.state !== "released"),
      },
      {
        id: "I5-one-active-shared-grant-plus-one-surge",
        test: (s) => {
          const active = s.grants.filter(
            (g) => g.svc === "web" && g.state !== "released" && !g.orphan,
          );
          return (
            active.filter((g) => !g.surge).length <= 1 && active.filter((g) => g.surge).length <= 1
          );
        },
      },
    ],
    edgeChecks: [
      {
        // Only the slot's live, never-revoked, never-moved grant hands its
        // attempt over; a revoked or superseded one must stop and certify.
        id: "adoption-only-of-a-live-unmoved-grant",
        test: (b, e) =>
          e.state.grants
            .filter(
              (g) =>
                g.evidence === "adoption" &&
                b.grants.some((x) => x.svc === g.svc && x.gen === g.gen && x.evidence === null),
            )
            .every((g) => {
              const before = b.grants.find((x) => x.svc === g.svc && x.gen === g.gen);
              const newer = b.grants.some(
                (x) => x.svc === g.svc && x.gen > g.gen && x.state !== "released",
              );
              return before !== undefined && before.revokedAt === null && !before.orphan && !newer;
            }),
      },
      {
        id: "I2-generations-rise",
        test: (b, e) =>
          e.state.grants
            .filter((g) => !b.grants.some((x) => x.svc === g.svc && x.gen === g.gen))
            .every((g) => g.gen > b.high[g.svc]) &&
          e.state.high.db >= b.high.db &&
          e.state.high.web >= b.high.web,
      },
      {
        id: "no-new-exclusive-generation-without-evidence",
        test: (b, e) =>
          e.state.grants
            .filter((g) => g.svc === "db" && g.gen > b.high.db)
            .every((g) =>
              e.state.grants
                .filter((x) => x.svc === "db" && x.gen !== g.gen)
                .every(
                  (x) =>
                    x.state === "released" &&
                    (x.evidence === "cert" ||
                      x.evidence === "fence" ||
                      x.evidence === "cancel" ||
                      x.evidence === "adoption"),
                ),
            ),
      },
      {
        // A copy replaced on silence (marked orphan-possible in this step) was
        // on a node silent for at least the policy delay.
        id: "failover-delay-wins",
        test: (b, e) => {
          const orphaned = e.state.grants.filter(
            (x) =>
              x.orphan &&
              !b.grants.find((y) => y.svc === x.svc && y.gen === x.gen)?.orphan &&
              x.node === "n1",
          );
          return orphaned.length === 0 || b.t - b.last >= DELAY_TICKS;
        },
      },
    ],
    witnesses: witnessesFor(cfg),
  };
}

const DB_WITNESSES: Record<string, (s: S) => boolean> = {
  "exclusive-moves-only-after-fence": (s) =>
    s.fencedAt !== null && s.grants.some((g) => g.node === "n2" && g.running),
  "partitioned-exclusive-keeps-running-past-delay": (s) =>
    !s.link && s.t - s.last > DELAY_TICKS && s.grants.some((g) => g.node === "n1" && g.running),
  "restart-quarantine-then-reissue": (s) =>
    s.inc === 2 && s.grants.some((g) => g.inc === 2 && g.node === "n1" && g.running),
};

const WEB_WITNESSES: Record<string, (s: S) => boolean> = {
  "shared-copies-overlap-during-partition": (s) =>
    !s.link && s.grants.filter((g) => g.running).length === 2,
  "restart-rebinds-with-overlap-not-gap": (s) =>
    s.inc === 2 &&
    s.grants.some((g) => g.inc === 1 && g.running) &&
    s.grants.some((g) => g.inc === 2 && g.running),
  "superseded-copy-certified-on-rejoin": (s) => s.link && s.grants.some((g) => g.orphan && g.cert),
};

const ADOPTED: Record<string, (s: S) => boolean> = {
  "restart-adopts-the-held-attempt": (s) =>
    s.grants.some((g) => g.adopted && g.running && g.node === "n1"),
};

function witnessesFor(cfg: Config): Record<string, (s: S) => boolean> {
  if (cfg.svc === "db")
    return cfg.restart === "hold" ? { ...DB_WITNESSES, ...ADOPTED } : DB_WITNESSES;
  return WEB_WITNESSES;
}

const DB = { svc: "db", dbPolicy: "reschedule", fence: true, restart: "quarantine" } as const;
const HOLD = { ...DB, restart: "hold" } as const;

// Each exhaustive exploration takes seconds and grows with the model; the
// default 5 s budget makes them flaky on a busy CI runner.
setDefaultTimeout(60_000);

describe("failover model (exhaustive at small bounds)", () => {
  test("exclusive, reschedule, fence enabled: every invariant holds and each witness is reachable", () => {
    expect(check(world(DB))).toMatchObject({ status: "holds", missingWitnesses: [] });
  });

  test("exclusive, reschedule, no fence: the slot never moves on silence", () => {
    const m = world({ ...DB, fence: false });
    const r = check({
      ...m,
      witnesses: {
        "partitioned-exclusive-keeps-running-past-delay":
          DB_WITNESSES["partitioned-exclusive-keeps-running-past-delay"] ?? (() => false),
      },
      invariants: [
        ...m.invariants,
        { id: "never-fences-without-an-enabled-adapter", test: (s) => s.fenceAt === null },
      ],
    });
    expect(r).toMatchObject({ status: "holds", missingWitnesses: [] });
  });

  test("exclusive, stay: only ever placed on its home node, re-issued there after a restart", () => {
    const m = world({ ...DB, dbPolicy: "stay" });
    const r = check({
      ...m,
      witnesses: {
        "restart-quarantine-then-reissue":
          DB_WITNESSES["restart-quarantine-then-reissue"] ?? (() => false),
      },
      invariants: [
        ...m.invariants,
        { id: "stay-home", test: (s) => s.grants.every((g) => g.node === s.home) },
      ],
    });
    expect(r).toMatchObject({ status: "holds", missingWitnesses: [] });
  });

  test("shared, reschedule: overlap is allowed, accounted, cleaned up on rejoin, and a restart re-binds without a gap", () => {
    expect(check(world({ ...DB, svc: "web" }))).toMatchObject({
      status: "holds",
      missingWitnesses: [],
    });
  });

  test.each([
    ["exclusive", HOLD],
    ["shared", { ...HOLD, svc: "web" as const }],
  ] as const)(
    "%s, restart holds its attempts: the live unmoved grant is adopted, nothing else, never beside a moved slot",
    (_, cfg) => {
      expect(check(world(cfg))).toMatchObject({ status: "holds", missingWitnesses: [] });
    },
  );

  test("a planner that adopted a revoked grant is caught", () => {
    const r = check(world({ ...HOLD, fence: false, mutant: "adopt-revoked" }));
    expect(r.status === "violated" && r.invariant).toBe("adoption-only-of-a-live-unmoved-grant");
  });

  test.each([
    ["silence-as-stop", DB, "positive-retirement"],
    ["revoke-as-release", DB, "positive-retirement"],
    ["delay-ignored", { ...DB, svc: "web" as const }, "failover-delay-wins"],
  ] as const)("weakened controller %s is caught by %s", (mutant, cfg, invariant) => {
    const r = check(world({ ...cfg, mutant }));
    expect(r.status).toBe("violated");
    expect(r.status === "violated" && r.invariant).toBe(invariant);
  });

  test.each(["silence-as-stop", "revoke-as-release"] as const)(
    "weakened controller %s runs two exclusive processes at once",
    (mutant) => {
      const m = world({ ...DB, mutant });
      const r = check({
        ...m,
        invariants: m.invariants.filter((i) => i.id === "G-PROCESS"),
        edgeChecks: [],
      });
      expect(r.status === "violated" && r.invariant).toBe("G-PROCESS");
    },
  );
});
