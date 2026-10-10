import { Result } from "better-result";
/**
 * The SMTP TLS choice is explicit and independent of auth.
 *
 * Before, one `secure` flag drove both: with a username and secure=false the
 * SDK always tried STARTTLS (an authenticated relay without TLS, e.g. a LAN
 * smarthost, failed "502 Command not implemented"), and with no username it
 * always sent in plain text (an unauthenticated relay could not require TLS).
 * These drive the real send path (`sendViaSmtpServer` -> the SDK's SMTP
 * client) against a minimal in-process SMTP server that offers no STARTTLS,
 * the shape of a typical LAN relay.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// @otterdeploy/email reads the validated server env at import; nothing here
// touches Postgres or Redis. `??=` so a real value wins.
/* oxlint-disable-next-line node/no-process-env -- test env setup boundary, before the dynamic import below */
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
/* oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above) */
process.env.REDIS_URL ??= "redis://127.0.0.1:1";
/* oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above) */
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3000";
/* oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above) */
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
/* oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above) */
process.env.CORS_ORIGIN ??= "http://127.0.0.1:3000";

const { sendViaSmtpServer } = await import("../client");
const { smtpTlsOptions, parseSmtpTlsMode } = await import("../smtp-tls");

/** Every command the server saw, per connection, and whether mail landed. */
const sessions: { commands: string[]; delivered: boolean }[] = [];

/** A plain-text relay: EHLO advertises AUTH but not STARTTLS. */
function startRelay() {
  return Bun.listen<{
    session: { commands: string[]; delivered: boolean };
    buffer: string;
    inData: boolean;
  }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        const session = { commands: [], delivered: false };
        sessions.push(session);
        socket.data = { session, buffer: "", inData: false };
        socket.write("220 relay.test ESMTP\r\n");
      },
      data(socket, chunk) {
        const state = socket.data;
        state.buffer += new TextDecoder().decode(chunk);
        let newline = state.buffer.indexOf("\r\n");
        while (newline >= 0) {
          const line = state.buffer.slice(0, newline);
          state.buffer = state.buffer.slice(newline + 2);
          newline = state.buffer.indexOf("\r\n");
          if (state.inData) {
            if (line === ".") {
              state.inData = false;
              state.session.delivered = true;
              socket.write("250 2.0.0 Ok: queued\r\n");
            }
            continue;
          }
          const verb = line.split(" ")[0]?.toUpperCase() ?? "";
          state.session.commands.push(verb === "AUTH" ? "AUTH" : verb);
          if (verb === "EHLO") socket.write("250-relay.test\r\n250 AUTH PLAIN LOGIN\r\n");
          else if (verb === "AUTH") socket.write("235 2.7.0 Authentication successful\r\n");
          else if (verb === "MAIL" || verb === "RCPT") socket.write("250 2.1.0 Ok\r\n");
          else if (verb === "DATA") {
            state.inData = true;
            socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          } else if (verb === "QUIT") socket.write("221 2.0.0 Bye\r\n");
          else socket.write("502 5.5.1 Command not implemented\r\n");
        }
      },
    },
  });
}

let relay: ReturnType<typeof startRelay>;
beforeAll(() => {
  relay = startRelay();
});
afterAll(() => relay.stop(true));

const message = {
  from: "otterdeploy@relay.test",
  to: "ops@relay.test",
  subject: "TLS mode",
  text: "hello",
};

async function send(config: Omit<Parameters<typeof sendViaSmtpServer>[0], "host">) {
  sessions.length = 0;
  const sent = await Result.tryPromise({
    try: () => sendViaSmtpServer({ ...config, host: "127.0.0.1", port: relay.port }, message),
    catch: (cause) => cause,
  });
  return { sent, session: sessions[0] };
}

describe("SMTP TLS mode", () => {
  test("tlsMode none: an authenticated relay without TLS delivers (explicit opt-in)", async () => {
    const { sent, session } = await send({ tlsMode: "none", user: "relay", pass: "pw" });
    expect(sent.isOk()).toBe(true);
    expect(session?.commands).toContain("AUTH");
    expect(session?.commands).not.toContain("STARTTLS");
    expect(session?.delivered).toBe(true);
  });

  test("tlsMode starttls: an unauthenticated relay that cannot do TLS is refused, nothing sent in clear", async () => {
    const { sent, session } = await send({ tlsMode: "starttls" });
    expect(sent.isErr()).toBe(true);
    expect(session?.commands).toContain("STARTTLS");
    expect(session?.commands).not.toContain("MAIL");
    expect(session?.delivered).toBe(false);
  });

  test("no mode stored keeps the legacy meaning: plain without a user, STARTTLS with one", async () => {
    const plain = await send({ secure: false });
    expect(plain.sent.isOk()).toBe(true);
    expect(plain.session?.commands).not.toContain("STARTTLS");

    const authed = await send({ secure: false, user: "relay", pass: "pw" });
    expect(authed.sent.isErr()).toBe(true);
    expect(authed.session?.commands).toContain("STARTTLS");
  });

  test("option mapping", () => {
    expect(smtpTlsOptions({ tlsMode: "implicit" })).toEqual({
      secure: true,
      requireTLS: false,
      allowInsecureAuth: false,
    });
    expect(smtpTlsOptions({ tlsMode: "starttls", secure: true }).secure).toBe(false);
    expect(smtpTlsOptions({ tlsMode: null, secure: true }).secure).toBe(true);
    expect(parseSmtpTlsMode("starttls")).toBe("starttls");
    expect(parseSmtpTlsMode("tls")).toBeNull();
    expect(parseSmtpTlsMode(undefined)).toBeNull();
  });
});
