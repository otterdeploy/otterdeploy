/**
 * An invitation whose email fails is no longer silent.
 *
 * The REAL auth instance's `createInvitation` (what inviteMember calls) sends
 * through the product's own email client; only Resend's API is stood in for,
 * at `fetch`, answering the way Resend documents (`429 rate_limit_exceeded`
 * with `retry-after`).
 *
 * Before: the SDK's default of zero retries lost the email on one 429,
 * sendInvitationEmail swallowed the error, inviteMember answered 200 and the
 * members page showed a pending invite indistinguishable from a delivered one.
 * Now a transient 429 is retried after Retry-After with one idempotency key,
 * and the outcome is recorded on the invitation (API response and
 * list-invitations, which the members page reads).
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { auth } from "@otterdeploy/auth";
import { db } from "@otterdeploy/db";
import { invitation, member, session, user } from "@otterdeploy/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { seedOrganization, uniq } from "../postgres-seed";

vi.hoisted(() => {
  // oxlint-disable-next-line node/no-process-env -- test env boundary: the transport must be Resend before @otterdeploy/env evaluates it
  process.env.RESEND_API_KEY = "re_invitation_test";
});

interface ResendPost {
  status: number;
  idempotencyKey: string | null;
}

/** Every POST /emails Resend answered, oldest first. */
const posts: ResendPost[] = [];
/** Answers queued ahead of a 200, oldest first. */
const failures: Array<{ status: number; headers: Record<string, string> }> = [];
let failEverySend = false;

const RATE_LIMITED = {
  status: 429,
  headers: { "retry-after": "1" },
};

const realFetch = globalThis.fetch;
const fakeFetch: typeof fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.resend.com") return realFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    const failure = failEverySend ? RATE_LIMITED : failures.shift();
    const status = failure?.status ?? 200;
    posts.push({ status, idempotencyKey: headers.get("idempotency-key") });
    const body =
      status === 200
        ? { id: `email_${posts.length}` }
        : { name: "rate_limit_exceeded", statusCode: status, message: "Too many requests." };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...failure?.headers },
    });
  },
  { preconnect: realFetch.preconnect },
);

let organizationId: OrganizationId;
let ownerHeaders: Headers;

async function createOwner(): Promise<Headers> {
  const [created] = await db
    .insert(user)
    .values({ name: "inviter", email: `inviter-${uniq()}@otterdeploy.test`, emailVerified: true })
    .returning({ id: user.id });
  if (!created) throw new Error("user insert returned no row");
  await db.insert(member).values({ organizationId, userId: created.id, role: "owner" });
  const token = randomBytes(24).toString("base64url");
  await db.insert(session).values({
    token,
    userId: created.id,
    expiresAt: new Date(Date.now() + 3_600_000),
    updatedAt: new Date(),
    activeOrganizationId: organizationId,
  });
  return new Headers({ authorization: `Bearer ${token}` });
}

async function inviteMember(email: string) {
  return auth.api.createInvitation({
    body: { email, role: "member", organizationId },
    headers: ownerHeaders,
  });
}

async function storedOutcome(email: string) {
  const [row] = await db
    .select({ emailStatus: invitation.emailStatus, emailError: invitation.emailError })
    .from(invitation)
    .where(eq(invitation.email, email));
  return row;
}

describe("invitation email outcome", () => {
  beforeAll(async () => {
    vi.stubGlobal("fetch", fakeFetch);
    organizationId = await seedOrganization("invite-email");
    ownerHeaders = await createOwner();
  });

  afterEach(() => {
    failures.length = 0;
    failEverySend = false;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
  });

  it("a delivered invitation is recorded as sent", async () => {
    const email = `invitee-${uniq()}@example.com`;
    const created = await inviteMember(email);
    expect(created).toMatchObject({ email, emailStatus: "sent" });
    expect(await storedOutcome(email)).toEqual({ emailStatus: "sent", emailError: null });
  });

  it("a 429 with retry-after: 1 is retried once, with one idempotency key, and delivered", async () => {
    failures.push(RATE_LIMITED);
    const before = posts.length;
    const email = `invitee-${uniq()}@example.com`;
    const created = await inviteMember(email);
    expect(created).toMatchObject({ emailStatus: "sent" });
    const sent = posts.slice(before);
    expect(sent.map((post) => post.status)).toEqual([429, 200]);
    // Every attempt for one invitation carries the same idempotency key.
    const keys = new Set(sent.map((post) => post.idempotencyKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBeTruthy();
  });

  it("a persistent 429 leaves the invitation pending and says the email failed", async () => {
    failEverySend = true;
    const before = posts.length;
    const email = `invitee-${uniq()}@example.com`;
    const created = await inviteMember(email);
    // The invitation exists (its link works) and the response says what happened.
    expect(created).toMatchObject({ email, status: "pending", emailStatus: "failed" });
    expect(created.emailError).toContain("429");
    // Bounded: the first try and two retries.
    expect(posts.length - before).toBe(3);

    const listed = await auth.api.listInvitations({
      query: { organizationId },
      headers: ownerHeaders,
    });
    const row = listed.find((entry) => entry.email === email);
    expect(row).toMatchObject({ status: "pending", emailStatus: "failed" });
  });

  it("a provider asking for a minute is not waited on: one attempt, failed", async () => {
    failures.push({ status: 429, headers: { "retry-after": "60" } });
    const before = posts.length;
    const created = await inviteMember(`invitee-${uniq()}@example.com`);
    expect(created).toMatchObject({ emailStatus: "failed" });
    expect(posts.length - before).toBe(1);
  });

  it("a re-send records the new outcome either way", async () => {
    const email = `invitee-${uniq()}@example.com`;
    failEverySend = true;
    await inviteMember(email);
    expect(await storedOutcome(email)).toMatchObject({ emailStatus: "failed" });

    failEverySend = false;
    const resent = await auth.api.createInvitation({
      body: { email, role: "member", organizationId, resend: true },
      headers: ownerHeaders,
    });
    expect(resent).toMatchObject({ emailStatus: "sent" });
    expect(await storedOutcome(email)).toEqual({ emailStatus: "sent", emailError: null });

    failEverySend = true;
    await auth.api.createInvitation({
      body: { email, role: "member", organizationId, resend: true },
      headers: ownerHeaders,
    });
    expect(await storedOutcome(email)).toMatchObject({ emailStatus: "failed" });
  });
});
