import { describe, expect, test } from "vitest";

import { demuxDockerStream } from "../cscli";

/** Build one docker attach mux frame: [stream, 0,0,0, len(BE)] + payload. */
function frame(stream: 1 | 2, payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const head = Buffer.alloc(8);
  head[0] = stream;
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

describe("demuxDockerStream", () => {
  test("concatenates stdout frames", () => {
    const buf = Buffer.concat([frame(1, '[{"id":'), frame(1, "1}]")]);
    expect(demuxDockerStream(buf)).toBe('[{"id":1}]');
  });

  test("merges stdout and stderr in arrival order (cscliRun contract)", () => {
    const buf = Buffer.concat([frame(2, "Parsing values\n"), frame(1, "Imported 42 decisions\n")]);
    expect(demuxDockerStream(buf)).toBe("Parsing values\nImported 42 decisions\n");
  });

  test("non-framed text passes through untouched", () => {
    expect(demuxDockerStream(Buffer.from("plain output\n"))).toBe("plain output\n");
    expect(demuxDockerStream(Buffer.from(""))).toBe("");
  });

  test("truncated trailing frame keeps whatever payload arrived", () => {
    const cut = Buffer.concat([frame(1, "complete"), frame(1, "partial")]).subarray(
      0,
      8 + 8 + 8 + 4,
    );
    expect(demuxDockerStream(cut)).toBe("completepart");
  });
});
