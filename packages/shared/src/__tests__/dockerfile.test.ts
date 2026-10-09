import { describe, expect, test } from "bun:test";

import { dockerfileExposedPorts } from "../dockerfile";

describe("dockerfileExposedPorts", () => {
  test("reads the final stage of a multi-stage build (the it-tools shape)", () => {
    const text = [
      "# build stage",
      "FROM node:lts-alpine AS build-stage",
      "WORKDIR /app",
      "RUN pnpm build",
      "",
      "# production stage",
      "FROM nginx:stable-alpine AS production-stage",
      "COPY --from=build-stage /app/dist /usr/share/nginx/html",
      "EXPOSE 80",
      'CMD ["nginx", "-g", "daemon off;"]',
    ].join("\n");
    expect(dockerfileExposedPorts(text)).toEqual([80]);
  });

  test("an EXPOSE in an earlier stage does not leak into the final image", () => {
    const text = "FROM node AS dev\nEXPOSE 5173\nFROM nginx\nCMD nginx\n";
    expect(dockerfileExposedPorts(text)).toEqual([]);
  });

  test("several ports, protocols, ranges and continuations", () => {
    const text = "FROM x\nEXPOSE 8080/tcp \\\n  53/udp 9000-9010 8080\n";
    expect(dockerfileExposedPorts(text)).toEqual([8080, 9000]);
  });

  test("resolves a port the stage declared with ARG or ENV", () => {
    expect(dockerfileExposedPorts("FROM x\nARG PORT=4000\nEXPOSE $PORT\n")).toEqual([4000]);
    expect(dockerfileExposedPorts("FROM x\nENV PORT 8000\nEXPOSE ${PORT}\n")).toEqual([8000]);
    expect(dockerfileExposedPorts("FROM x\nEXPOSE ${PORT:-8081}\n")).toEqual([8081]);
  });

  test("drops what it cannot resolve instead of guessing", () => {
    expect(dockerfileExposedPorts("FROM x\nEXPOSE $UNSET\n")).toEqual([]);
    expect(dockerfileExposedPorts("FROM x\nCMD serve\n")).toEqual([]);
    expect(dockerfileExposedPorts("FROM x\nEXPOSE 70000\n")).toEqual([]);
  });

  test("keywords are case-insensitive", () => {
    expect(dockerfileExposedPorts("from x\nexpose 3001\n")).toEqual([3001]);
  });
});
