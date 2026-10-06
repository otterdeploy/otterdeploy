/**
 * Evidence for one run, written to a temp dir outside the repo. Everything
 * passes through the redactor first: known secret values (bootstrap token,
 * admin password, session cookies) and secret-shaped env lines never land on
 * disk or in the terminal.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { LabResult } from "./support";

import { evidenceDir } from "./state";
import { nowInstant, secondsSince } from "./support";

const SECRET_LINE =
  /^([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|KEY|DATABASE_URL|REDIS_URL)[A-Z0-9_]*)=.*$/gm;
// The installer prints the token on the line after this heading when it has a TTY.
const TOKEN_BANNER = /(First-account bootstrap token[^\n]*\n\s*)(\S+)/g;
const COOKIE = /((?:better-auth|__Secure-better-auth)\.[a-z_]+=)[^;\s"]+/g;

export class Redactor {
  private readonly secrets = new Set<string>();

  add(secret: string): void {
    if (secret.length >= 6) this.secrets.add(secret);
  }

  redact(text: string): string {
    let out = text
      .replace(SECRET_LINE, "$1=<redacted>")
      .replace(COOKIE, "$1<redacted>")
      .replace(TOKEN_BANNER, "$1<redacted>");
    for (const secret of this.secrets) out = out.split(secret).join("<redacted>");
    return out;
  }
}

export interface StepTiming {
  step: string;
  ok: boolean;
  seconds: number;
  detail: string;
}

export class Evidence {
  readonly dir: string;
  readonly redactor = new Redactor();
  readonly timings: StepTiming[] = [];

  constructor(run: string) {
    this.dir = evidenceDir(run);
  }

  write(name: string, content: string): void {
    writeFileSync(join(this.dir, name), this.redactor.redact(content));
  }

  json(name: string, value: unknown): void {
    this.write(name, `${JSON.stringify(value, null, 2)}\n`);
  }

  append(name: string, line: string): void {
    appendFileSync(join(this.dir, name), `${this.redactor.redact(line)}\n`);
  }

  log(message: string): void {
    const line = this.redactor.redact(message);
    console.log(line);
    appendFileSync(join(this.dir, "run.log"), `${nowInstant().toString()} ${line}\n`);
  }

  /** Run one named step, time it, and record the outcome. */
  async step<T>(name: string, body: () => Promise<LabResult<T>>, describe?: (value: T) => string) {
    this.log(`>> ${name}`);
    const started = nowInstant();
    const result = await body();
    const seconds = secondsSince(started);
    const detail = result.isOk()
      ? (describe?.(result.value) ?? "ok")
      : `${result.error.where}: ${result.error.message}`;
    this.timings.push({
      step: name,
      ok: result.isOk(),
      seconds,
      detail: this.redactor.redact(detail),
    });
    this.log(`<< ${name}: ${result.isOk() ? "OK" : "FAILED"} in ${seconds}s (${detail})`);
    this.json("timings.json", this.timings);
    return result;
  }
}
