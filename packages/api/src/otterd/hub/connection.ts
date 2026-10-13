import type { Signer } from "@otterdeploy/otterd-cp";
import type { OrganizationId } from "@otterdeploy/shared/id";

/** One node connection: its handshake state, session and outstanding requests. */
import { type ControlFrame, DEFAULT_LIMITS, type OpOutcome } from "@otterdeploy/otterd-proto";
import { TaggedError } from "better-result";
import { log } from "evlog";

import type { KnownNode, Pending } from "./handshake";

/** What the hub needs from a WebSocket. */
export interface Socket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

export interface Session {
  sessionId: string;
  node: KnownNode;
  incarnation: string;
  bootId: string;
}

const HANDSHAKE_MS = 10_000;

export type Answer =
  | { kind: "outcome"; duplicate: boolean; outcome: OpOutcome }
  | { kind: "refused"; error: unknown };

export class Connection {
  state: "hello" | "authenticate" | "ready" | "closed" = "hello";
  pending: Pending | null = null;
  node: KnownNode | null = null;
  session: Session | null = null;
  lastTouch = 0;
  nextId = 1;
  readonly waiting = new Map<number, (a: Answer) => void>();
  queue: Promise<void> = Promise.resolve();
  readonly timer: ReturnType<typeof setTimeout>;

  constructor(
    readonly socket: Socket,
    onTimeout: () => void,
  ) {
    this.timer = setTimeout(onTimeout, HANDSHAKE_MS);
  }

  send(frame: ControlFrame): void {
    const text = JSON.stringify(frame);
    if (text.length > DEFAULT_LIMITS.maxFrameBytes) {
      log.error({
        otterd: {
          event: "frame over the control limit not sent",
          frame: frame.type,
          bytes: text.length,
        },
      });
      return;
    }
    this.socket.send(text);
  }
}

export interface HubConfig {
  installId: string;
  signer: Signer;
  authorityTerm: () => number;
  findNode: (nodeId: string) => Promise<KnownNode | null>;
  organizationId: OrganizationId | null;
  now: () => number;
  /** Something changed that the scheduler should look at. */
  wake: () => void;
}

export class HubError extends TaggedError("HubError")<{ message: string; code: string }>() {}

export interface RequestOptions {
  opId: string;
  operationEpoch: number;
  resourceId?: string;
  grantId?: string;
  binding?: { slot: { resourceId: string; index: number }; grantId: string; generation: number };
  timeoutMs?: number;
}
