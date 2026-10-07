import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";

import { containerCommand } from "../start-command";

/** What Railpack's `ENTRYPOINT ["/bin/bash", "-c"]` makes of a CMD: the argv
 *  the started process actually receives (printed one word per line). */
function argvBehindBashC(cmd: string[]): string[] {
  const [script, ...rest] = cmd;
  if (script === undefined) return [];
  // Swap the program for printf so the words it would have been given show up.
  const ran = spawnSync("/bin/bash", ["-c", `printf '%s\\n' ${script}`, ...rest], {
    encoding: "utf8",
  });
  return ran.stdout.split("\n").slice(0, -1);
}

const railpack = { entrypoint: null, imageBuilder: "railpack" as const };

describe("containerCommand", () => {
  // ["node", "server.js"] reached Railpack's `bash -c` as CMD, so
  // bash ran a bare `node` (server.js became $0) and the container exited 0.
  it("hands an exec-form command to a Railpack image as one shell line", () => {
    const cmd = containerCommand({ ...railpack, command: ["node", "server.js"] });
    expect(cmd).toEqual(["node server.js"]);
    expect(argvBehindBashC(cmd ?? [])).toEqual(["node", "server.js"]);
  });

  it("keeps every word intact through the shell, quotes and spaces included", () => {
    const argv = ["sh", "-c", "echo 'hi' && exit $X", "a b", "", "*", "it's"];
    const cmd = containerCommand({ ...railpack, command: argv });
    expect(cmd).toHaveLength(1);
    expect(argvBehindBashC(cmd ?? [])).toEqual(argv);
  });

  it("leaves a one-entry command alone: on Railpack it is already a shell line", () => {
    expect(containerCommand({ ...railpack, command: ["npm run start"] })).toEqual([
      "npm run start",
    ]);
  });

  it("passes the command through unchanged for a Dockerfile or pulled image", () => {
    const command = ["node", "server.js"];
    expect(containerCommand({ command, entrypoint: null, imageBuilder: "dockerfile" })).toEqual(
      command,
    );
    expect(containerCommand({ command, entrypoint: null, imageBuilder: null })).toEqual(command);
  });

  it("passes the command through unchanged when the service sets its own entrypoint", () => {
    const command = ["server.js", "--port", "3000"];
    expect(containerCommand({ ...railpack, command, entrypoint: ["node"] })).toEqual(command);
  });

  it("keeps an unset command unset, so the image's own start command runs", () => {
    expect(containerCommand({ ...railpack, command: null })).toBeNull();
    expect(containerCommand({ ...railpack, command: [] })).toEqual([]);
  });
});
