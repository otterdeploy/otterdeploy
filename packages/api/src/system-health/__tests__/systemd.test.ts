/**
 * The systemd collector, driven entirely off FIXTURE STRINGS of real
 * `systemctl show` / `list-units` output. No live host is involved: the whole
 * point of the exec seam is that the parsing, the UINT64_MAX handling, the
 * CPU-delta arithmetic and the never-active skip are testable on a mac.
 */
import { describe, expect, it } from "vite-plus/test";

import {
  computeCpuPct,
  getSystemdUnits,
  getUnitDetails,
  parseActiveEnter,
  parseActiveState,
  parseCounter,
  parseCounterBig,
  parseListUnitNames,
  parseShowProperties,
  parseSubState,
  readMemory,
  unescapeUnitName,
  type CpuBaseline,
  type SystemctlExec,
} from "../systemd";

const UINT64_MAX = "18446744073709551615";

// Verbatim from `systemctl show docker.service --property=…` on Debian 12.
const DOCKER_SHOW = `Id=docker.service
LoadState=loaded
ActiveState=active
SubState=running
CPUUsageNSec=1200000000
MemoryCurrent=104857600
MemoryPeak=209715200
NRestarts=2
ActiveEnterTimestamp=Mon 2026-08-18 09:12:31 UTC
ActiveEnterTimestampMonotonic=31245678
`;

// A oneshot that has never fired: systemd zeroes every timestamp and reports
// the accounting counters as "not available".
const NEVER_ACTIVE_SHOW = `Id=e2scrub_all.service
LoadState=loaded
ActiveState=inactive
SubState=dead
CPUUsageNSec=${UINT64_MAX}
MemoryCurrent=${UINT64_MAX}
MemoryPeak=${UINT64_MAX}
NRestarts=0
ActiveEnterTimestamp=
ActiveEnterTimestampMonotonic=0
`;

const LIST_UNITS = `  docker.service                loaded active   running Docker Application Container Engine
  ssh.service                   loaded active   running OpenBSD Secure Shell server
● crowdsec.service              loaded failed   failed  CrowdSec Security Engine
  e2scrub_all.service           loaded inactive dead    Online ext4 Metadata Check for All Filesystems
`;

describe("parseShowProperties", () => {
  it("splits on the FIRST '=' so values keeping their own are intact", () => {
    const props = parseShowProperties(
      "ExecStart={ path=/usr/bin/dockerd ; argv[]=/usr/bin/dockerd -H fd:// }\nId=docker.service\n",
    );
    expect(props.Id).toBe("docker.service");
    expect(props.ExecStart).toBe("{ path=/usr/bin/dockerd ; argv[]=/usr/bin/dockerd -H fd:// }");
  });

  it("an empty value is a present key, not a missing one", () => {
    const props = parseShowProperties("ActiveEnterTimestamp=\n");
    expect(props).toHaveProperty("ActiveEnterTimestamp");
    expect(props.ActiveEnterTimestamp).toBe("");
  });

  it("blank and separator lines are ignored, not guessed at", () => {
    const props = parseShowProperties("Id=a.service\n\n=orphan\nno-equals-here\n");
    expect(Object.keys(props)).toEqual(["Id"]);
  });
});

describe("unescapeUnitName", () => {
  it("\\x2d becomes a dash", () => {
    expect(unescapeUnitName("dev-disk-by\\x2duuid-8f3c.device")).toBe(
      "dev-disk-by-uuid-8f3c.device",
    );
  });

  it("a run of escapes decodes as UTF-8, not as one code point per byte", () => {
    // "café" → c a f \xc3\xa9
    expect(unescapeUnitName("caf\\xc3\\xa9.service")).toBe("café.service");
  });

  it("a name with nothing to unescape is returned untouched", () => {
    expect(unescapeUnitName("docker.service")).toBe("docker.service");
  });
});

describe("state parsers", () => {
  it("known states round-trip", () => {
    expect(parseActiveState("activating")).toBe("activating");
    expect(parseSubState("auto-restart")).toBe("auto-restart");
  });

  it("an unrecognised state falls back to 'unknown' rather than a neighbour", () => {
    // A state a newer systemd invented must never be silently read as
    // "inactive" or "failed": that is a fabricated claim about the host.
    expect(parseActiveState("refreshing")).toBe("unknown");
    expect(parseSubState("brand-new-substate")).toBe("unknown");
    expect(parseActiveState(undefined)).toBe("unknown");
    expect(parseSubState("")).toBe("unknown");
  });
});

describe("UINT64_MAX handling", () => {
  it("the sentinel reads as null, never as 18 exabytes", () => {
    expect(parseCounter(UINT64_MAX)).toBeNull();
    expect(parseCounterBig(UINT64_MAX)).toBeNull();
  });

  it("a real number one below the sentinel is still a real number", () => {
    // Only the sentinel is excluded; the value one below it is a real count.
    expect(parseCounter("18446744073709551614")).not.toBeNull();
    expect(parseCounterBig("18446744073709551614")).toBe(18446744073709551614n);
  });

  it("missing or non-numeric values are null", () => {
    expect(parseCounter(undefined)).toBeNull();
    expect(parseCounter("")).toBeNull();
    expect(parseCounter("[not set]")).toBeNull();
    expect(parseCounter("-1")).toBeNull();
  });

  it("both memory counters null out together when accounting is off", () => {
    expect(
      readMemory(parseShowProperties(`MemoryCurrent=${UINT64_MAX}\nMemoryPeak=${UINT64_MAX}\n`)),
    ).toEqual({ memBytes: null, memPeakBytes: null });
  });
});

describe("readMemory", () => {
  it("a peak below current is raised to current", () => {
    // Kernels without memory.peak report a flat 0 forever.
    expect(readMemory(parseShowProperties("MemoryCurrent=5000\nMemoryPeak=0\n"))).toEqual({
      memBytes: 5000,
      memPeakBytes: 5000,
    });
  });

  it("a genuine peak above current is left alone", () => {
    expect(readMemory(parseShowProperties("MemoryCurrent=5000\nMemoryPeak=9000\n"))).toEqual({
      memBytes: 5000,
      memPeakBytes: 9000,
    });
  });

  it("an unavailable peak stays null instead of echoing current", () => {
    // Echoing current would dress a missing measurement as a real one.
    expect(
      readMemory(parseShowProperties(`MemoryCurrent=5000\nMemoryPeak=${UINT64_MAX}\n`)),
    ).toEqual({ memBytes: 5000, memPeakBytes: null });
  });
});

describe("parseActiveEnter", () => {
  it("a monotonic 0 means the unit has never been active", () => {
    expect(parseActiveEnter(parseShowProperties(NEVER_ACTIVE_SHOW))).toEqual({
      neverActive: true,
    });
  });

  it("a monotonic UINT64_MAX likewise", () => {
    expect(
      parseActiveEnter(parseShowProperties(`ActiveEnterTimestampMonotonic=${UINT64_MAX}\n`)),
    ).toEqual({ neverActive: true });
  });

  it("the D-Bus spelling is microseconds since the epoch", () => {
    const result = parseActiveEnter(
      parseShowProperties(
        "ActiveEnterTimestamp=1755506751000000\nActiveEnterTimestampMonotonic=31245678\n",
      ),
    );
    expect(result.neverActive).toBe(false);
    expect(result.neverActive === false && result.at?.toISOString()).toBe(
      new Date(1755506751000).toISOString(),
    );
  });

  it("an unreadable timestamp is 'unknown when', NOT 'never active'", () => {
    const result = parseActiveEnter(
      parseShowProperties("ActiveEnterTimestamp=\nActiveEnterTimestampMonotonic=31245678\n"),
    );
    expect(result).toEqual({ neverActive: false, at: null });
  });
});

describe("parseListUnitNames", () => {
  it("takes the first column and drops the failed-unit bullet", () => {
    expect(parseListUnitNames(LIST_UNITS)).toEqual([
      "docker.service",
      "ssh.service",
      "crowdsec.service",
      "e2scrub_all.service",
    ]);
  });

  it("blank output yields no units rather than one empty name", () => {
    expect(parseListUnitNames("\n   \n")).toEqual([]);
  });
});

describe("computeCpuPct", () => {
  const oneSecondNs = 1_000_000_000n;

  it("the first reading of a unit is 0, not a lifetime average", () => {
    expect(computeCpuPct(undefined, 500_000_000n, oneSecondNs, 4)).toBe(0);
  });

  it("half a core over one second on a 4-core host is 12.5%", () => {
    const previous: CpuBaseline = { cpuNSec: 0n, atNs: 0n };
    expect(computeCpuPct(previous, 500_000_000n, oneSecondNs, 4)).toBe(12.5);
  });

  it("a full core over one second on a 1-core host is 100%", () => {
    const previous: CpuBaseline = { cpuNSec: 0n, atNs: 0n };
    expect(computeCpuPct(previous, oneSecondNs, oneSecondNs, 1)).toBe(100);
  });

  it("a counter reset reads 0, never a negative percent", () => {
    // The unit restarted; systemd reset its cgroup accounting, so the
    // cumulative counter went backwards.
    const previous: CpuBaseline = { cpuNSec: 9_000_000_000n, atNs: 0n };
    expect(computeCpuPct(previous, 12_000_000n, oneSecondNs, 4)).toBe(0);
  });

  it("a counter beyond 2^53 still subtracts exactly", () => {
    const previous: CpuBaseline = { cpuNSec: 9_007_199_254_740_993n, atNs: 0n };
    expect(computeCpuPct(previous, 9_007_199_254_740_993n + 250_000_000n, oneSecondNs, 1)).toBe(25);
  });

  it("zero elapsed time yields 0 instead of Infinity", () => {
    const previous: CpuBaseline = { cpuNSec: 0n, atNs: oneSecondNs };
    expect(computeCpuPct(previous, 500_000_000n, oneSecondNs, 4)).toBe(0);
  });

  it("an unavailable CPU counter yields 0", () => {
    const previous: CpuBaseline = { cpuNSec: 0n, atNs: 0n };
    expect(computeCpuPct(previous, null, oneSecondNs, 4)).toBe(0);
  });
});

/** Fixture-backed systemctl: `list-units` → LIST_UNITS, `show X` → shows[X]. */
function fakeExec(shows: Record<string, string>, list = LIST_UNITS): SystemctlExec {
  return (argv) => {
    if (argv[0] === "list-units") return Promise.resolve(list);
    const unit = argv[1];
    if (argv[0] === "show" && unit !== undefined) return Promise.resolve(shows[unit] ?? null);
    return Promise.resolve(null);
  };
}

const SSH_SHOW = `Id=ssh.service
ActiveState=active
SubState=running
CPUUsageNSec=100000000
MemoryCurrent=8388608
MemoryPeak=0
NRestarts=0
ActiveEnterTimestamp=Mon 2026-08-18 09:12:30 UTC
ActiveEnterTimestampMonotonic=30000000
`;

const CROWDSEC_SHOW = `Id=crowdsec.service
ActiveState=failed
SubState=failed
CPUUsageNSec=42000000
MemoryCurrent=${UINT64_MAX}
MemoryPeak=${UINT64_MAX}
NRestarts=7
ActiveEnterTimestamp=Mon 2026-08-18 09:20:00 UTC
ActiveEnterTimestampMonotonic=530000000
`;

describe("getSystemdUnits", () => {
  const shows = {
    "docker.service": DOCKER_SHOW,
    "ssh.service": SSH_SHOW,
    "crowdsec.service": CROWDSEC_SHOW,
    "e2scrub_all.service": NEVER_ACTIVE_SHOW,
  };

  it("a host without systemd returns null quietly", async () => {
    let called = false;
    const section = await getSystemdUnits({
      hasSystemd: () => false,
      exec: () => {
        called = true;
        return Promise.resolve(null);
      },
    });
    expect(section).toBeNull();
    // Probe BEFORE invoking: no systemctl is spawned on a mac.
    expect(called).toBe(false);
  });

  it("a wedged systemctl degrades the section to null", async () => {
    const section = await getSystemdUnits({
      hasSystemd: () => true,
      exec: () => Promise.resolve(null),
    });
    expect(section).toBeNull();
  });

  it("collects the units and skips the one that has never been active", async () => {
    const section = await getSystemdUnits({
      hasSystemd: () => true,
      exec: fakeExec(shows),
      cpuCount: 4,
      nowNs: () => 0n,
      now: () => new Date("2026-08-21T00:00:00.000Z"),
      baselines: new Map(),
    });
    expect(section?.sampledAt).toBe("2026-08-21T00:00:00.000Z");
    expect(section?.units.map((u) => u.name)).toEqual([
      "docker.service",
      "ssh.service",
      "crowdsec.service",
    ]);
    expect(section?.units[0]).toEqual({
      name: "docker.service",
      activeState: "active",
      subState: "running",
      cpuPct: 0, // first reading
      memBytes: 104857600,
      memPeakBytes: 209715200,
      restartCount: 2,
      activeEnterTimestamp: new Date("Mon 2026-08-18 09:12:31 UTC").toISOString(),
    });
    // crowdsec has no memory accounting: null, not 18 exabytes.
    expect(section?.units[2]?.memBytes).toBeNull();
    expect(section?.units[2]?.restartCount).toBe(7);
    expect(section?.units[2]?.activeState).toBe("failed");
  });

  it("the second report derives a real rate from the counter delta", async () => {
    const baselines = new Map();
    const options = {
      hasSystemd: () => true,
      cpuCount: 4,
      baselines,
    };
    await getSystemdUnits({ ...options, exec: fakeExec(shows), nowNs: () => 0n });

    // One second later, docker burned another 2s of CPU across 4 cores = 50%.
    const secondPass = DOCKER_SHOW.replace("CPUUsageNSec=1200000000", "CPUUsageNSec=3200000000");
    const section = await getSystemdUnits({
      ...options,
      exec: fakeExec({ ...shows, "docker.service": secondPass }),
      nowNs: () => 1_000_000_000n,
    });
    expect(section?.units[0]?.cpuPct).toBe(50);
  });

  it("a restarted unit's backwards counter reads 0, not a negative", async () => {
    const baselines = new Map();
    const options = { hasSystemd: () => true, cpuCount: 4, baselines };
    await getSystemdUnits({ ...options, exec: fakeExec(shows), nowNs: () => 0n });

    const restarted = DOCKER_SHOW.replace("CPUUsageNSec=1200000000", "CPUUsageNSec=4000000");
    const section = await getSystemdUnits({
      ...options,
      exec: fakeExec({ ...shows, "docker.service": restarted }),
      nowNs: () => 1_000_000_000n,
    });
    expect(section?.units[0]?.cpuPct).toBe(0);

    // …and the baseline re-anchored, so the pass AFTER the reset is a real rate
    // measured from the restarted counter rather than another 0.
    const third = DOCKER_SHOW.replace("CPUUsageNSec=1200000000", "CPUUsageNSec=404000000");
    const after = await getSystemdUnits({
      ...options,
      exec: fakeExec({ ...shows, "docker.service": third }),
      nowNs: () => 2_000_000_000n,
    });
    expect(after?.units[0]?.cpuPct).toBe(10);
  });

  it("a unit whose property read fails is dropped, not faked", async () => {
    const section = await getSystemdUnits({
      hasSystemd: () => true,
      exec: fakeExec({ ...shows, "ssh.service": "" }, LIST_UNITS),
      baselines: new Map(),
    });
    // An empty `show` yields no properties, so no timestamp: never-active.
    expect(section?.units.map((u) => u.name)).toEqual(["docker.service", "crowdsec.service"]);
  });

  it("operator patterns are passed through to systemctl as argv, not a shell", async () => {
    let listArgs: string[] = [];
    await getSystemdUnits({
      hasSystemd: () => true,
      patterns: ["docker.service", "ssh*.service"],
      baselines: new Map(),
      exec: (argv) => {
        if (argv[0] === "list-units") {
          listArgs = argv;
          return Promise.resolve("");
        }
        return Promise.resolve(null);
      },
    });
    expect(listArgs).toContain("--type=service");
    expect(listArgs.slice(-3)).toEqual(["--", "docker.service", "ssh*.service"]);
  });

  it("no patterns means every service, with no trailing separator", async () => {
    let listArgs: string[] = [];
    await getSystemdUnits({
      hasSystemd: () => true,
      patterns: [],
      baselines: new Map(),
      exec: (argv) => {
        listArgs = argv;
        return Promise.resolve("");
      },
    });
    expect(listArgs).not.toContain("--");
  });
});

describe("getUnitDetails", () => {
  it("returns the full property set for one unit, name unescaped", async () => {
    const props = await getUnitDetails("docker.service", {
      hasSystemd: () => true,
      exec: () =>
        Promise.resolve(
          "Id=dev-disk-by\\x2duuid-8f3c.device\nFragmentPath=/lib/systemd/system/docker.service\nType=notify\n",
        ),
    });
    expect(props?.Id).toBe("dev-disk-by-uuid-8f3c.device");
    expect(props?.FragmentPath).toBe("/lib/systemd/system/docker.service");
  });

  it("null on a host without systemd", async () => {
    expect(await getUnitDetails("docker.service", { hasSystemd: () => false })).toBeNull();
  });

  it("null when systemctl does not answer", async () => {
    expect(
      await getUnitDetails("docker.service", {
        hasSystemd: () => true,
        exec: () => Promise.resolve(null),
      }),
    ).toBeNull();
  });
});
