import { describe, it, expect } from 'vitest';
import { HASH_SEED, hashFloat, hashInt, hashString, finalizeHash } from '../hash';

/**
 * Desync detection: each client hashes its SimWorld every 60 ticks and the two
 * are compared. A hash that ignores a field means a divergence in that field goes
 * unreported until the two screens visibly disagree — so every test here is about
 * sensitivity, not speed.
 */

describe('hashInt', () => {
  it('is stable for the same input', () => {
    expect(hashInt(HASH_SEED, 42)).toBe(hashInt(HASH_SEED, 42));
  });

  it('changes for a different value', () => {
    expect(hashInt(HASH_SEED, 42)).not.toBe(hashInt(HASH_SEED, 43));
  });

  it('distinguishes a one-bit difference', () => {
    expect(hashInt(HASH_SEED, 0b1000)).not.toBe(hashInt(HASH_SEED, 0b1001));
  });

  it('distinguishes zero from negative zero-adjacent values', () => {
    expect(hashInt(HASH_SEED, 0)).not.toBe(hashInt(HASH_SEED, -1));
  });

  it('is order dependent', () => {
    const ab = hashInt(hashInt(HASH_SEED, 1), 2);
    const ba = hashInt(hashInt(HASH_SEED, 2), 1);
    expect(ab).not.toBe(ba);
  });

  it('stays an unsigned 32-bit integer', () => {
    let hash = HASH_SEED;
    for (let i = 0; i < 1_000; i += 1) {
      hash = hashInt(hash, i * 7919);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('hashFloat', () => {
  /**
   * Fighter positions are fractional (x = 497.5600000000003 after a walk), so the
   * hash must cover the full float64 payload. Truncating to an int would hide
   * exactly the sub-pixel drift that rollback desyncs are made of.
   */
  it('distinguishes values that differ by one ULP', () => {
    const a = 497.56;
    const b = a + Number.EPSILON * 256;
    expect(a).not.toBe(b);
    expect(hashFloat(HASH_SEED, a)).not.toBe(hashFloat(HASH_SEED, b));
  });

  it('distinguishes an integer from its float neighbour', () => {
    expect(hashFloat(HASH_SEED, 350)).not.toBe(hashFloat(HASH_SEED, 350.0000001));
  });

  it('distinguishes +0 from -0', () => {
    // A fighter with vx = -0 vs vx = +0 behaves identically, but the bit patterns
    // differ; catching it here is cheaper than debugging a phantom desync.
    expect(hashFloat(HASH_SEED, 0)).not.toBe(hashFloat(HASH_SEED, -0));
  });

  it('is stable for the same value', () => {
    expect(hashFloat(HASH_SEED, -690.125)).toBe(hashFloat(HASH_SEED, -690.125));
  });

  it('is order dependent', () => {
    expect(hashFloat(hashFloat(HASH_SEED, 1.5), 2.5))
      .not.toBe(hashFloat(hashFloat(HASH_SEED, 2.5), 1.5));
  });
});

describe('hashString', () => {
  it('distinguishes fighter ids', () => {
    expect(hashString(HASH_SEED, 'collapse')).not.toBe(hashString(HASH_SEED, 'cry'));
  });

  it('distinguishes strings of the same length', () => {
    expect(hashString(HASH_SEED, 'salad')).not.toBe(hashString(HASH_SEED, 'alien'));
  });

  it('distinguishes an empty string from no call at all', () => {
    expect(hashString(HASH_SEED, '')).not.toBe(HASH_SEED);
  });

  it('is stable for the same input', () => {
    expect(hashString(HASH_SEED, 'wizard-ult')).toBe(hashString(HASH_SEED, 'wizard-ult'));
  });
});

describe('mixed field hashing', () => {
  it('detects a change in any single field of a fighter-shaped record', () => {
    const hashFighter = (f: { id: string; hp: number; x: number; state: number; energy: number }) =>
      finalizeHash(
        hashInt(hashFloat(hashFloat(hashString(HASH_SEED, f.id), f.hp), f.x), f.state) ^ f.energy,
      );

    const base = { id: 'collapse', hp: 100, x: 350, state: 0, energy: 0 };
    const baseline = hashFighter(base);

    expect(hashFighter({ ...base, id: 'cry' })).not.toBe(baseline);
    expect(hashFighter({ ...base, hp: 99.5 })).not.toBe(baseline);
    expect(hashFighter({ ...base, x: 350.001 })).not.toBe(baseline);
    expect(hashFighter({ ...base, state: 1 })).not.toBe(baseline);
    expect(hashFighter({ ...base, energy: 5 })).not.toBe(baseline);
  });
});

describe('finalizeHash', () => {
  it('returns an unsigned 32-bit integer', () => {
    for (const value of [0, HASH_SEED, -1, 0xffffffff, 123456789]) {
      const result = finalizeHash(value);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('is stable and injective enough to separate near neighbours', () => {
    expect(finalizeHash(1)).toBe(finalizeHash(1));
    expect(finalizeHash(1)).not.toBe(finalizeHash(2));
  });
});
