import { describe, it, expect } from "vitest";
import { takeUpTo } from "@/lib/util/asyncLimit";

function makeGen(n: number, counter: { produced: number }) {
  return (async function* () {
    for (let i = 0; i < n; i++) {
      counter.produced++;
      yield i;
    }
  })();
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("takeUpTo", () => {
  it("yields everything when n is null / 0 / negative (no limit)", async () => {
    for (const n of [null, undefined, 0, -5] as const) {
      const c = { produced: 0 };
      const got = await collect(takeUpTo(makeGen(4, c), n));
      expect(got).toEqual([0, 1, 2, 3]);
      expect(c.produced).toBe(4);
    }
  });

  it("caps at n and stops pulling from the source early", async () => {
    const c = { produced: 0 };
    const got = await collect(takeUpTo(makeGen(100, c), 3));
    expect(got).toEqual([0, 1, 2]);
    // crucial: the generator must NOT have produced all 100 (adapter stops fetching)
    expect(c.produced).toBe(3);
  });

  it("returns all when n >= length", async () => {
    const c = { produced: 0 };
    expect(await collect(takeUpTo(makeGen(2, c), 5))).toEqual([0, 1]);
    expect(c.produced).toBe(2);
  });

  it("returns all when n == length", async () => {
    const c = { produced: 0 };
    expect(await collect(takeUpTo(makeGen(3, c), 3))).toEqual([0, 1, 2]);
    expect(c.produced).toBe(3);
  });

  it("handles an empty source", async () => {
    const c = { produced: 0 };
    expect(await collect(takeUpTo(makeGen(0, c), 5))).toEqual([]);
    expect(c.produced).toBe(0);
  });
});
