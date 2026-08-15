/**
 * Seeded xorshift32.
 *
 * `Math.random()` must never appear in the simulation: two clients would diverge
 * on the first CPU decision or stage roll. The generator's entire state is one
 * uint32 that lives inside SimWorld, so it snapshots, serialises and replays with
 * the rest of the world. The host picks the seed and sends it in `match_start`.
 *
 * Only integer bit operations are used — no `Math.pow`/`exp`/`sin`, which are not
 * guaranteed bit-identical across JavaScript engines.
 *
 * See docs/sim-spec.md §10 rows 8-9.
 */

export interface Rng {
  state: number;
}

/** xorshift32 has a fixed point at 0, so a zero seed is remapped. */
const ZERO_SEED_REPLACEMENT = 0x9e3779b9;

export function createRng(seed: number): Rng {
  const normalized = Math.trunc(seed) >>> 0;
  return { state: normalized === 0 ? ZERO_SEED_REPLACEMENT : normalized };
}

/** An independent copy, for snapshotting a world without advancing the original. */
export function cloneRng(rng: Rng): Rng {
  return { state: rng.state };
}

export function nextUint32(rng: Rng): number {
  let x = rng.state;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rng.state = x >>> 0;
  return rng.state;
}

/** Uniform in `[0, 1)`. */
export function nextFloat(rng: Rng): number {
  // Divide by 2^32 rather than multiplying by a reciprocal literal: the divisor is
  // a power of two, so the result is exact on every engine.
  return nextUint32(rng) / 4294967296;
}

/** Uniform in `[min, max)`. */
export function nextRange(rng: Rng, min: number, max: number): number {
  return min + nextFloat(rng) * (max - min);
}

/** Uniform integer in `[minInclusive, maxExclusive)`. */
export function nextInt(rng: Rng, minInclusive: number, maxExclusive: number): number {
  const span = maxExclusive - minInclusive;
  if (span <= 1) return minInclusive;
  return minInclusive + Math.floor(nextFloat(rng) * span);
}
