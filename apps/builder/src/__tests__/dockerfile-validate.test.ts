import { describe, expect, test } from "bun:test";

import {
  assertDockerfileValid,
  formatDockerfileError,
  parseInstructions,
  validateDockerfile,
} from "../dockerfile-validate";

describe("parseInstructions", () => {
  test("skips comments and blank lines, uppercases keywords", () => {
    const instrs = parseInstructions(`# a comment
FROM node:20

run echo hi
`);
    expect(instrs.map((i) => i.keyword)).toEqual(["FROM", "RUN"]);
    expect(instrs[0]?.line).toBe(2);
    expect(instrs[1]?.line).toBe(4);
  });

  test("joins line continuations into one instruction at the start line", () => {
    const instrs = parseInstructions(`RUN apt-get update \\
  && apt-get install -y curl`);
    expect(instrs).toHaveLength(1);
    expect(instrs[0]?.keyword).toBe("RUN");
    expect(instrs[0]?.line).toBe(1);
  });

  test("does not treat a VOLUME word inside a RUN heredoc as an instruction", () => {
    const instrs = parseInstructions(`FROM alpine
RUN <<EOF
echo VOLUME is just text here
VOLUME still text
EOF
CMD ["sh"]`);
    expect(instrs.map((i) => i.keyword)).toEqual(["FROM", "RUN", "CMD"]);
  });
});

describe("validateDockerfile", () => {
  // VOLUME used to be a hard error, which refused many widely used apps with
  // no way through. It is a warning now; the build log says the
  // path is backed by a persistent volume after the build.
  test("warns on VOLUME with its line number, never refuses the build", () => {
    const { errors, warnings } = validateDockerfile(`FROM node:20
WORKDIR /app
VOLUME /data
CMD ["node", "server.js"]`);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.instruction).toBe("VOLUME");
    expect(warnings[0]?.line).toBe(3);
    expect(warnings[0]?.message).toContain("/data");
    expect(warnings[0]?.fix).toContain("persistent volume");
  });

  test("a compose build is told to declare the volume in its compose file", () => {
    const { errors, warnings } = validateDockerfile("FROM x\nVOLUME /data", "compose");
    expect(errors).toHaveLength(0);
    expect(warnings[0]?.fix).toContain("compose file");
  });

  test("does not flag a valid Dockerfile", () => {
    const { errors, warnings } = validateDockerfile(`FROM node:20
COPY . .
RUN npm ci
CMD ["node", "server.js"]`);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test("does not flag a lowercase 'volume' appearing as an argument", () => {
    const { warnings } = validateDockerfile(`FROM node:20
RUN echo "creating volume dir" && mkdir /volume`);
    expect(warnings).toHaveLength(0);
  });

  test("reports the real line number for VOLUME after a continued instruction", () => {
    const { warnings } = validateDockerfile(`FROM node:20
RUN set -e \\
  && apt-get update
VOLUME /data`);
    expect(warnings[0]?.line).toBe(4);
  });
});

describe("assertDockerfileValid", () => {
  test("a VOLUME passes, with the warning forwarded to the build log", () => {
    const lines: string[] = [];
    assertDockerfileValid('FROM gitea/gitea\nVOLUME ["/data"]', (m) => lines.push(m));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^dockerfile warning: VOLUME at line 2/);
  });
});

describe("formatDockerfileError", () => {
  test("renders a single Railway-style line", () => {
    const line = formatDockerfileError({
      line: 1,
      instruction: "X",
      message: "X is not supported.",
      fix: "Remove it.",
    });
    expect(line).toBe("dockerfile invalid: X is not supported. Remove it.");
  });
});
