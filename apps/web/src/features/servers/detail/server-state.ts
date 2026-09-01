/**
 * One server, one state. Every surface on the server page (header pill, the
 * banner, the fleet card, the rail) reads the same derivation so a box can
 * never be "Connected" in one place and "stale" in another.
 *
 * The order is deliberate and mirrors what the operator would act on first:
 * a machine that never finished provisioning has no telemetry to be stale;
 * a machine swarm reports as down is down regardless of its last report; a
 * pause or drain the operator chose is never an alert; and only then does
 * the health report's freshness decide connected vs stale vs silent.
 */

import type { ServerHealthEntry } from "@/features/servers/data/health";
import type { Server } from "@/features/servers/data/server";

import { timeAgo } from "@/shared/lib/time";

export type ServerStateKind =
  | "provisioning"
  | "failed"
  | "down"
  | "paused"
  | "draining"
  | "unreported"
  | "stale"
  | "connected";

export type ServerStateTone = "good" | "warn" | "bad" | "muted" | "accent";

export interface ServerState {
  kind: ServerStateKind;
  /** Short label for a pill: "Connected", "Stale", "Down"… */
  label: string;
  /** One clause of context beside the label: "reported 12 s ago". */
  detail: string;
  tone: ServerStateTone;
}

/** The control plane's own row. It is never removable and its shell is a
 *  local PTY rather than an SSH hop (mirrors `stats-attribution.ts`). */
export function isControlPlaneRow(
  server: Pick<Server, "role" | "host" | "name" | "labels">,
): boolean {
  return (
    server.labels.includes("bootstrap") ||
    (server.role === "manager" && (server.host === "127.0.0.1" || server.name === "localhost"))
  );
}

export function deriveServerState(
  server: Pick<Server, "provisionStatus" | "status" | "availability" | "provisionError">,
  entry: Pick<ServerHealthEntry, "stale" | "receivedAt"> | null,
): ServerState {
  if (server.provisionStatus === "failed") {
    return {
      kind: "failed",
      label: "Provisioning failed",
      detail: server.provisionError ?? "see the provisioning log",
      tone: "bad",
    };
  }
  if (server.provisionStatus !== "ready") {
    return {
      kind: "provisioning",
      label: "Provisioning",
      detail: server.provisionStatus,
      tone: "accent",
    };
  }
  if (server.status === "down") {
    return {
      kind: "down",
      label: "Down",
      detail: entry ? `last report ${timeAgo(entry.receivedAt)}` : "no report received",
      tone: "bad",
    };
  }
  if (server.availability === "pause") {
    return { kind: "paused", label: "Paused", detail: "scheduling paused by you", tone: "muted" };
  }
  if (server.availability === "drain") {
    return { kind: "draining", label: "Draining", detail: "tasks are moving off", tone: "warn" };
  }
  if (entry === null) {
    return {
      kind: "unreported",
      label: "No report yet",
      detail: "waiting for the first health report",
      tone: "muted",
    };
  }
  if (entry.stale) {
    return {
      kind: "stale",
      label: "Stale",
      detail: `last report ${timeAgo(entry.receivedAt)}`,
      tone: "warn",
    };
  }
  return {
    kind: "connected",
    label: "Connected",
    detail: `reported ${timeAgo(entry.receivedAt)}`,
    tone: "good",
  };
}

/** Whether the numbers on screen describe the box right now. Stale readings
 *  are still shown (greyed, with their age) because an old number beats no
 *  number; a paused or draining box still reports. */
export function isReporting(state: ServerStateKind): boolean {
  return state === "connected" || state === "paused" || state === "draining";
}

/** Whether a reading should be shown at all. */
export function hasReadings(state: ServerStateKind): boolean {
  return isReporting(state) || state === "stale";
}
