/**
 * The hub: the server side of every node's control session.
 *
 * One live session per node; a newer authenticated session of the same node
 * replaces the older one. After `ready` the hub answers pings with its wall
 * clock (the node's bounded clock), records slot reports and evidence of
 * life, renews leases only for grants with no committed revocation, acks
 * telemetry with credit, and carries requests: each command is recorded
 * before it is sent, under a short-lived capability bound to this session.
 */

import {
  type Command,
  type ControlFrame,
  type SignedEnvelope,
  DEFAULT_LIMITS,
  controlFrame,
} from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { log } from "evlog";

import { applySlotReports, sessionDown, sessionUp, touchEvidence } from "../store/reports";
import { acknowledgeAuthority } from "../store/serving-ack";
import {
  type Answer,
  Connection,
  type HubConfig,
  HubError,
  type RequestOptions,
  type Session,
  type Socket,
} from "./connection";
import { authenticate, welcome } from "./handshake";
import { answerLease } from "./lease";
import { recover } from "./recovery";
import { sendRequest, settleRequest } from "./requests";
import { telemetrySink } from "./telemetry";

const HANDSHAKE_FRAMES = new Set(["hello", "welcome", "authenticate", "ready", "reject"]);
const TOUCH_EVERY_MS = 1_000;

export class Hub {
  private readonly sessions = new Map<string, Connection>();
  private readonly telemetry: ReturnType<typeof telemetrySink>;

  constructor(private readonly cfg: HubConfig) {
    this.telemetry = telemetrySink(cfg.installId, cfg.organizationId);
  }

  open(socket: Socket): Connection {
    const conn: Connection = new Connection(socket, () => {
      if (conn.state !== "ready") this.drop(conn, "handshake timed out");
    });
    return conn;
  }

  message(conn: Connection, text: string): void {
    conn.queue = conn.queue.then(() => this.handle(conn, text));
  }

  closed(conn: Connection, why: string): void {
    if (conn.state === "closed") return;
    conn.state = "closed";
    clearTimeout(conn.timer);
    for (const resolve of conn.waiting.values())
      resolve({ kind: "refused", error: { code: "session-ended" } });
    conn.waiting.clear();
    const s = conn.session;
    if (s && this.sessions.get(s.node.nodeId) === conn) {
      this.sessions.delete(s.node.nodeId);
      void sessionDown(s.node.nodeId, s.sessionId, this.cfg.now(), why);
      this.cfg.wake();
    }
  }

  private drop(conn: Connection, why: string): void {
    conn.socket.close(1008, why.slice(0, 120));
    this.closed(conn, why);
  }

  private async handle(conn: Connection, text: string): Promise<void> {
    if (conn.state === "closed") return;
    if (text.length > DEFAULT_LIMITS.maxFrameBytes) return this.drop(conn, "frame over the limit");
    const json = Result.try((): unknown => JSON.parse(text));
    const parsed = controlFrame.safeParse(json.isOk() ? json.value : null);
    if (!parsed.success) {
      if (conn.state !== "ready") this.drop(conn, "malformed handshake frame");
      return; // A newer node may send frames this hub does not know.
    }
    const frame = parsed.data;
    if (conn.state === "hello") return this.hello(conn, frame);
    if (conn.state === "authenticate") return this.authenticated(conn, frame);
    return this.frame(conn, frame);
  }

  private async hello(conn: Connection, frame: ControlFrame): Promise<void> {
    if (frame.type !== "hello") return this.drop(conn, "expected hello");
    const node = await this.cfg.findNode(frame.nodeId);
    const r = welcome(frame, {
      installId: this.cfg.installId,
      authorityTerm: this.cfg.authorityTerm(),
      signer: this.cfg.signer,
      node,
      now: this.cfg.now(),
    });
    if (r.isErr()) {
      conn.send(r.error);
      return this.drop(conn, `rejected: ${r.error.code}`);
    }
    conn.pending = r.value;
    conn.node = node;
    conn.state = "authenticate";
    conn.send(r.value.welcome);
  }

  private async authenticated(conn: Connection, frame: ControlFrame): Promise<void> {
    const pending = conn.pending;
    const node = conn.node;
    if (!pending || !node) return this.drop(conn, "no pending handshake");
    const ok = authenticate(pending, frame, node.identityKey);
    if (ok.isErr()) {
      conn.send(ok.error);
      return this.drop(conn, `rejected: ${ok.error.code}`);
    }
    clearTimeout(conn.timer);
    if (pending.recovery) {
      // Not awaited: the recovery's requests are answered by frames this
      // connection's queue must stay free to handle.
      void recover(conn, pending, node, this.cfg).then((done) => {
        this.drop(conn, done ? "re-enrolled" : "recovery session ended without re-enrollment");
        if (done) this.cfg.wake();
      });
      return;
    }
    const session: Session = {
      sessionId: pending.welcome.sessionId,
      node,
      incarnation: pending.hello.incarnation,
      bootId: pending.hello.bootId,
    };
    const older = this.sessions.get(node.nodeId);
    if (older && older !== conn) {
      older.send({
        type: "goAway",
        code: "session-conflict",
        message: "a newer session replaced this one",
      });
      this.drop(older, "replaced by a newer session");
    }
    conn.session = session;
    conn.state = "ready";
    this.sessions.set(node.nodeId, conn);
    const up = await sessionUp(
      node.nodeId,
      { sessionId: session.sessionId, incarnation: session.incarnation, bootId: session.bootId },
      this.cfg.now(),
    );
    if (up.isErr()) return this.drop(conn, "could not record the session");
    conn.lastTouch = this.cfg.now();
    conn.send({ type: "ready", sessionId: session.sessionId });
    log.info({
      otterd: {
        event: "node session ready",
        node: node.nodeId,
        session: session.sessionId,
        incarnation: session.incarnation,
      },
    });
    this.cfg.wake();
  }

  private async touch(conn: Connection, s: Session): Promise<void> {
    const now = this.cfg.now();
    if (now - conn.lastTouch < TOUCH_EVERY_MS) return;
    conn.lastTouch = now;
    await touchEvidence(s.node.nodeId, s.sessionId, now);
  }

  private async frame(conn: Connection, frame: ControlFrame): Promise<void> {
    const s = conn.session;
    if (!s) return;
    await this.touch(conn, s);
    switch (frame.type) {
      case "ping":
        conn.send({
          type: "pong",
          seq: frame.seq,
          nodeMonoMs: frame.nodeMonoMs,
          cpUnixMs: this.cfg.now(),
        });
        return;
      case "slotReports": {
        const r = await applySlotReports(s.node.nodeId, s.sessionId, frame.slots, this.cfg.now());
        if (r.isOk() && r.value > 0) this.cfg.wake();
        return;
      }
      case "leaseRequest":
        return answerLease(conn, s, frame, this.cfg);
      case "authorityAck": {
        const freed = await acknowledgeAuthority(s.node.nodeId, frame, this.cfg.now());
        if (freed.isOk() && freed.value > 0) this.cfg.wake();
        return;
      }
      case "telemetry": {
        const { type: _, ...batch } = frame;
        const ack = await this.telemetry(batch);
        conn.send({ type: "telemetryAck", batchId: batch.batchId, ...ack });
        return;
      }
      case "response":
      case "requestRefused":
        settleRequest(conn, frame);
        return;
      default:
        if (HANDSHAKE_FRAMES.has(frame.type)) this.drop(conn, `${frame.type} after ready`);
    }
  }

  /** The live control session of a node, if it has one. */
  sessionOf(nodeId: string): string | null {
    return this.sessions.get(nodeId)?.session?.sessionId ?? null;
  }

  /** Push a signed authority document on the node's session; false if none is up. */
  pushAuthority(nodeId: string, document: SignedEnvelope): boolean {
    const conn = this.sessions.get(nodeId);
    if (!conn?.session) return false;
    conn.send({ type: "authority", document });
    return true;
  }

  /**
   * Send one command and wait for its answer. The command is recorded first;
   * a timeout leaves it `unknown` (the node may still execute it: its op id
   * and payload hash make a retry safe).
   */
  request(
    nodeId: string,
    command: Command,
    opts: RequestOptions,
  ): Promise<Result<Answer, HubError>> {
    const conn = this.sessions.get(nodeId);
    if (!conn?.session) {
      return Promise.resolve(
        Result.err(new HubError({ message: `${nodeId} has no session`, code: "not-connected" })),
      );
    }
    return sendRequest(conn, conn.session, command, opts, this.cfg);
  }
}

export type { Answer, Connection, HubConfig, RequestOptions, Socket };
