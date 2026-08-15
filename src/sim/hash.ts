/**
 * FNV-1a hashing primitives for desync detection.
 *
 * Each client hashes its SimWorld every 60 ticks and the two are compared. The
 * hash must therefore be sensitive to every field that can diverge — including
 * the low bits of fighter positions, which is where floating-point drift shows up
 * first. Anything the hash ignores is a divergence that goes unreported until the
 * two screens visibly disagree.
 *
 * All operations are integer bit ops, so the result is identical on every engine.
 */

export const HASH_SEED = 0x811c9dc5;

const FNV_PRIME = 0x01000193;

/** Scratch buffer for reading the raw bytes of a float64. Reused; never resized. */
const FLOAT_VIEW = new DataView(new ArrayBuffer(8));

function mixByte(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
}

/** Mix in a 32-bit integer, byte by byte. */
export function hashInt(hash: number, value: number): number {
  const v = value | 0;
  let next = hash >>> 0;
  next = mixByte(next, v & 0xff);
  next = mixByte(next, (v >>> 8) & 0xff);
  next = mixByte(next, (v >>> 16) & 0xff);
  next = mixByte(next, (v >>> 24) & 0xff);
  return next;
}

/**
 * Mix in the full 64-bit payload of a number.
 *
 * Hashing the IEEE bits rather than a rounded value is the point: `497.56` and
 * `497.5600000000003` must produce different hashes, because that is exactly the
 * kind of sub-pixel drift a desync starts as. It also separates `+0` from `-0`.
 */
export function hashFloat(hash: number, value: number): number {
  FLOAT_VIEW.setFloat64(0, value, true);
  let next = hash >>> 0;
  for (let i = 0; i < 8; i += 1) next = mixByte(next, FLOAT_VIEW.getUint8(i));
  return next;
}

/** Mix in a string (fighter ids, attack spec ids). */
export function hashString(hash: number, value: string): number {
  // Length is mixed first so that '' still perturbs the hash, and so that two
  // different splits of the same characters cannot collide.
  let next = hashInt(hash, value.length);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    next = mixByte(next, code & 0xff);
    next = mixByte(next, (code >>> 8) & 0xff);
  }
  return next;
}

/** Mix in a boolean. */
export function hashBool(hash: number, value: boolean): number {
  return mixByte(hash >>> 0, value ? 1 : 0);
}

/** Final avalanche, so neighbouring accumulator values land far apart. */
export function finalizeHash(hash: number): number {
  let h = hash >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
