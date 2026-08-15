import { describe, it, expect } from 'vitest';
import { createRng, cloneRng, nextUint32, nextFloat, nextInt, nextRange } from '../rng';

/**
 * `Math.random()` cannot appear anywhere in src/sim — two clients would diverge
 * on the first CPU decision or stage roll. This xorshift32 is seeded from the
 * host and lives inside SimWorld, so it snapshots and replays with everything
 * else. See docs/sim-spec.md §10 rows 8-9.
 */

describe('createRng', () => {
  it('produces the same stream for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const drawA = Array.from({ length: 32 }, () => nextUint32(a));
    const drawB = Array.from({ length: 32 }, () => nextUint32(b));
    expect(drawA).toEqual(drawB);
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 16 }, ((r) => () => nextUint32(r))(createRng(1)));
    const b = Array.from({ length: 16 }, ((r) => () => nextUint32(r))(createRng(2)));
    expect(a).not.toEqual(b);
  });

  it('survives a zero seed', () => {
    // xorshift32 has a fixed point at 0: without a guard the stream is all zeros.
    const rng = createRng(0);
    const draws = Array.from({ length: 8 }, () => nextUint32(rng));
    expect(new Set(draws).size).toBeGreaterThan(1);
    expect(draws.every((value) => value === 0)).toBe(false);
  });

  it('normalises the seed into a uint32', () => {
    // Seeds arrive over the wire and may be negative or fractional.
    expect(createRng(-1).state).toBe(createRng(0xffffffff).state);
    expect(Number.isInteger(createRng(7.9).state)).toBe(true);
  });
});

describe('nextUint32', () => {
  it('stays inside the unsigned 32-bit range', () => {
    const rng = createRng(0xc0ffee);
    for (let i = 0; i < 10_000; i += 1) {
      const value = nextUint32(rng);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('advances the state on every draw', () => {
    const rng = createRng(99);
    const before = rng.state;
    nextUint32(rng);
    expect(rng.state).not.toBe(before);
  });

  it('does not repeat within ten thousand draws', () => {
    const rng = createRng(4242);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i += 1) seen.add(nextUint32(rng));
    expect(seen.size).toBe(10_000);
  });
});

describe('cloneRng', () => {
  it('detaches the copy so the original is unaffected', () => {
    const original = createRng(777);
    nextUint32(original);
    const copy = cloneRng(original);

    const fromCopy = Array.from({ length: 5 }, () => nextUint32(copy));
    const fromOriginal = Array.from({ length: 5 }, () => nextUint32(original));

    // Same stream, but drawing from one must not advance the other.
    expect(fromCopy).toEqual(fromOriginal);
  });
});

describe('nextFloat', () => {
  it('stays in [0, 1)', () => {
    const rng = createRng(31337);
    for (let i = 0; i < 10_000; i += 1) {
      const value = nextFloat(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('spreads roughly uniformly across the unit interval', () => {
    const rng = createRng(2024);
    const buckets = new Array<number>(10).fill(0);
    const samples = 100_000;
    for (let i = 0; i < samples; i += 1) buckets[Math.floor(nextFloat(rng) * 10)]! += 1;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(samples / 10 * 0.9);
      expect(count).toBeLessThan(samples / 10 * 1.1);
    }
  });
});

describe('nextInt', () => {
  it('covers the half-open range and nothing outside it', () => {
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i += 1) {
      const value = nextInt(rng, 3, 7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(7);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('returns the only possible value for a single-value range', () => {
    const rng = createRng(11);
    for (let i = 0; i < 10; i += 1) expect(nextInt(rng, 2, 3)).toBe(2);
  });
});

describe('nextRange', () => {
  it('stays within [min, max)', () => {
    const rng = createRng(808);
    for (let i = 0; i < 5_000; i += 1) {
      const value = nextRange(rng, 165, 225);
      expect(value).toBeGreaterThanOrEqual(165);
      expect(value).toBeLessThan(225);
    }
  });
});

describe('determinism as a whole', () => {
  it('reproduces a mixed sequence of draw kinds from the same seed', () => {
    const draw = (seed: number) => {
      const rng = createRng(seed);
      return [
        nextUint32(rng), nextFloat(rng), nextInt(rng, 0, 8),
        nextRange(rng, 100, 220), nextFloat(rng), nextUint32(rng),
      ];
    };
    expect(draw(20260815)).toEqual(draw(20260815));
  });
});
