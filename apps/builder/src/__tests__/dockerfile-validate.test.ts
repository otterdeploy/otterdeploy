import { describe, expect, test } from "bun:test";

import {
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
  test("flags VOLUME as a hard error with its line number and a fix", () => {
    const { errors } = validateDockerfile(`FROM node:20
WORKDIR /app
VOLUME /data
CMD ["node", "server.js"]`);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.instruction).toBe("VOLUME");
    expect(errors[0]?.line).toBe(3);
    expect(errors[0]?.fix).toContain("otterdeploy volume add");
  });

  test("does not flag a valid Dockerfile", () => {
    const { errors } = validateDockerfile(`FROM node:20
COPY . .
RUN npm ci
CMD ["node", "server.js"]`);
    expect(errors).toHaveLength(0);
  });

  test("does not flag a lowercase 'volume' appearing as an argument", () => {
    const { errors } = validateDockerfile(`FROM node:20
RUN echo "creating volume dir" && mkdir /volume`);
    expect(errors).toHaveLength(0);
  });

  test("reports the real line number for VOLUME after a continued instruction", () => {
    const { errors } = validateDockerfile(`FROM node:20
RUN set -e \\
  && apt-get update
VOLUME /data`);
    expect(errors[0]?.line).toBe(4);
  });
});

describe("formatDockerfileError", () => {
  test("renders a single Railway-style line", () => {
    const { errors } = validateDockerfile("FROM x\nVOLUME /data");
    const first = errors[0];
    if (!first) throw new Error("expected a VOLUME error");
    const line = formatDockerfileError(first);
    expect(line).toMatch(/^dockerfile invalid: /);
    expect(line).toContain("otterdeploy volume add");
  });
});
