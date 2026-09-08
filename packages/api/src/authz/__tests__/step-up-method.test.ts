/**
 * od-rvca: an account with no password must not be asked for one.
 *
 * The bug was the shape of the decision, not any single branch. It had exactly
 * two: 2FA → authenticator code, otherwise → password. There was no third, so
 * an account that has neither — invited and never set a password, passkey-only
 * (the `passkey` plugin is enabled), or social/SSO — fell into the password
 * branch and was asked for something that does not exist.
 *
 * That is not a bad error message, it is a LOCKOUT. Nothing the user could
 * type would ever verify, every attempt failed identically, and step-up gates
 * the highest-value actions in the product: opening a shell, enrolling a node.
 * The reported symptom was `otd exec` printing "Password:" then "Could not
 * open the shell connection", over and over.
 *
 * So these tests are the matrix, and the row that matters is the one that used
 * to be missing.
 */
import { describe, expect, it } from "vite-plus/test";

import { chooseStepUpMethod } from "../step-up";

const withTotp = { twoFactorEnabled: true };
const withoutTotp = { twoFactorEnabled: false };

describe("chooseStepUpMethod", () => {
  it("asks a passwordless account for an EMAILED code, not a password", () => {
    // THE regression, and its resolution. It first returned "password_required"
    // and the client re-prompted forever (od-rvca); then "no_credential", which
    // stopped the loop but sent the operator off to add a credential before
    // they could use the feature. The account already controls the mailbox it
    // was invited to, so that is the factor to ask for.
    expect(chooseStepUpMethod(withoutTotp, false, {})).toEqual({
      kind: "unusable",
      reason: "email_code_required",
    });
  });

  it("accepts the emailed code once supplied", () => {
    expect(chooseStepUpMethod(withoutTotp, false, { emailCode: "123456" })).toEqual({
      kind: "email_otp",
      code: "123456",
    });
  });

  it("ignores a password from an account that has none", () => {
    // Sending it to `verifyPassword` to fail as "incorrect" would read as "you
    // typed it wrong" and invite another attempt at something that cannot work.
    expect(chooseStepUpMethod(withoutTotp, false, { password: "anything" })).toEqual({
      kind: "unusable",
      reason: "email_code_required",
    });
  });

  it("uses the authenticator when the account has one", () => {
    expect(chooseStepUpMethod(withTotp, false, { totpCode: "123456" })).toEqual({
      kind: "totp",
      code: "123456",
    });
  });

  it("asks for the code when 2FA is on and none was sent", () => {
    expect(chooseStepUpMethod(withTotp, false, {})).toEqual({
      kind: "unusable",
      reason: "two_factor_code_required",
    });
  });

  it("prefers the authenticator over a password when both exist", () => {
    // 2FA is the stronger factor and the account's declared method; falling
    // back to the password would quietly weaken the gate.
    expect(chooseStepUpMethod(withTotp, true, { totpCode: "123456", password: "pw" })).toEqual({
      kind: "totp",
      code: "123456",
    });
  });

  it("uses the password when the account has one and no 2FA", () => {
    expect(chooseStepUpMethod(withoutTotp, true, { password: "pw" })).toEqual({
      kind: "password",
      password: "pw",
    });
  });

  it("asks for the password when the account has one and none was sent", () => {
    // Still distinct from `no_credential`: "you did not send it" is answerable,
    // and the client SHOULD prompt here.
    expect(chooseStepUpMethod(withoutTotp, true, {})).toEqual({
      kind: "unusable",
      reason: "password_required",
    });
  });

  it("never asks a passwordless account for a password, whatever it sends", () => {
    // The property, stated once: across every input shape, an account with
    // neither factor is asked for the emailed code and never for a password.
    for (const input of [{}, { password: "" }, { password: "pw" }, { totpCode: "123456" }]) {
      const chosen = chooseStepUpMethod(withoutTotp, false, input);
      expect(chosen).toEqual({ kind: "unusable", reason: "email_code_required" });
    }
  });

  it("does not offer the emailed code to an account with a stronger factor", () => {
    // Emailing a code to someone who has an authenticator or a password would
    // quietly add a WEAKER path to the same gate, which is the opposite of
    // stepping up. `sendStepUpEmailCode` refuses for the same reason.
    expect(chooseStepUpMethod(withTotp, false, { emailCode: "123456" })).toEqual({
      kind: "unusable",
      reason: "two_factor_code_required",
    });
    expect(chooseStepUpMethod(withoutTotp, true, { emailCode: "123456" })).toEqual({
      kind: "unusable",
      reason: "password_required",
    });
  });
});
