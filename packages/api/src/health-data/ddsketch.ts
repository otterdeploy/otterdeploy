/**
 * Versioned, mergeable DDSketch (Masson, Rim and Lee, VLDB 2019) for
 * successful probe latencies. Logarithmic mapping with relative accuracy
 * `alpha`; values below 1 count in a zero bin. Merging adds bin counts, so a
 * merged sketch is identical to the sketch of the union, which is what lets
 * hourly and daily buckets be exact merges of their children. It is NOT
 * subtractable: a correction rebuilds a bucket from the ledger, never patches
 * a stored sketch.
 *
 * Encoding v1: u8 version, u16 little-endian alpha×10 000, varint zero count,
 * varint bin count, then per bin in ascending index order a zigzag-varint
 * index delta and a varint count.
 */
import { Result, TaggedError } from "better-result";

const SKETCH_VERSION = 1;
const MAX_BINS = 4096;

class SketchDecodeError extends TaggedError("SketchDecodeError")<{ message: string }>() {}
class SketchMergeError extends TaggedError("SketchMergeError")<{ message: string }>() {}

export class DDSketch {
  readonly alpha: number;
  private readonly gamma: number;
  private readonly logGamma: number;
  private readonly bins = new Map<number, number>();
  private zeroCount = 0;
  private total = 0;

  constructor(alpha = 0.01) {
    this.alpha = alpha;
    this.gamma = (1 + alpha) / (1 - alpha);
    this.logGamma = Math.log(this.gamma);
  }

  /** Number of values added (including merged ones). */
  count(): number {
    return this.total;
  }

  add(value: number, weight = 1): void {
    this.total += weight;
    if (value < 1) {
      this.zeroCount += weight;
      return;
    }
    const index = Math.ceil(Math.log(value) / this.logGamma);
    this.bins.set(index, (this.bins.get(index) ?? 0) + weight);
    if (this.bins.size > MAX_BINS) this.collapseLowest();
  }

  merge(other: DDSketch): Result<void, SketchMergeError> {
    if (other.alpha !== this.alpha) {
      return Result.err(
        new SketchMergeError({ message: `alpha ${other.alpha} does not match ${this.alpha}` }),
      );
    }
    this.zeroCount += other.zeroCount;
    this.total += other.total;
    for (const [index, n] of other.bins) this.bins.set(index, (this.bins.get(index) ?? 0) + n);
    while (this.bins.size > MAX_BINS) this.collapseLowest();
    return Result.ok(undefined);
  }

  /** Value at quantile q in [0, 1]; null when empty. */
  quantile(q: number): number | null {
    if (this.total === 0) return null;
    const rank = q * (this.total - 1);
    if (rank < this.zeroCount) return 0;
    let seen = this.zeroCount;
    for (const index of [...this.bins.keys()].toSorted((a, b) => a - b)) {
      seen += this.bins.get(index) ?? 0;
      if (seen > rank) return (2 * this.gamma ** index) / (this.gamma + 1);
    }
    return null;
  }

  encode(): Uint8Array {
    const out: number[] = [SKETCH_VERSION];
    const a = Math.round(this.alpha * 10_000);
    out.push(a & 0xff, (a >> 8) & 0xff);
    pushVarint(out, this.zeroCount);
    const indexes = [...this.bins.keys()].toSorted((x, y) => x - y);
    pushVarint(out, indexes.length);
    let previous = 0;
    for (const index of indexes) {
      const delta = index - previous;
      pushVarint(out, delta >= 0 ? delta * 2 : -delta * 2 - 1);
      pushVarint(out, this.bins.get(index) ?? 0);
      previous = index;
    }
    return Uint8Array.from(out);
  }

  /** Decode a stored sketch; a corrupt or unknown-version blob is a typed error. */
  static decode(bytes: Uint8Array): Result<DDSketch, SketchDecodeError> {
    const fail = (message: string) => Result.err(new SketchDecodeError({ message }));
    if (bytes[0] !== SKETCH_VERSION) return fail(`unknown sketch version ${bytes[0]}`);
    if (bytes.length < 3) return fail("truncated sketch header");
    const sketch = new DDSketch(((bytes[1] ?? 0) | ((bytes[2] ?? 0) << 8)) / 10_000);
    const cursor = { at: 3 };
    const zero = readVarint(bytes, cursor);
    const n = readVarint(bytes, cursor);
    if (zero === null || n === null) return fail("truncated sketch header");
    sketch.zeroCount = zero;
    sketch.total = zero;
    let previous = 0;
    for (let i = 0; i < n; i++) {
      const z = readVarint(bytes, cursor);
      const c = readVarint(bytes, cursor);
      if (z === null || c === null) return fail("truncated sketch bins");
      const index = previous + (z % 2 === 0 ? z / 2 : -(z + 1) / 2);
      sketch.bins.set(index, c);
      sketch.total += c;
      previous = index;
    }
    return Result.ok(sketch);
  }

  private collapseLowest(): void {
    const [a, b] = [...this.bins.keys()].toSorted((x, y) => x - y);
    if (a === undefined || b === undefined) return;
    this.bins.set(b, (this.bins.get(b) ?? 0) + (this.bins.get(a) ?? 0));
    this.bins.delete(a);
  }
}

function pushVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

function readVarint(bytes: Uint8Array, cursor: { at: number }): number | null {
  let value = 0;
  let scale = 1;
  for (;;) {
    const b = bytes[cursor.at++];
    if (b === undefined) return null;
    value += (b & 0x7f) * scale;
    if (b < 0x80) return value;
    scale *= 0x80;
  }
}
