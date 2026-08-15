import { describe, it, expect } from 'vitest';
import {
  ARENA_MAX_X,
  ARENA_MIN_X,
  ATTACK_MULTIPLIER,
  CONTROL_RECOVERY_MULTIPLIER,
  FIGHTER_HURTBOX_HEIGHT,
  FIGHTER_HURTBOX_WIDTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  GRAVITY,
  GROUND_Y,
  INPUT_BUFFER_MS,
  JUMP_VELOCITY,
  RANGE_MULTIPLIER,
  ROUND_TIME_MS,
  SPEED_BY_STAT,
} from '../constants';

/**
 * These are the tuning numbers the simulation refactor must preserve exactly.
 * They are asserted as literals rather than recomputed from the formulas so that
 * a change to a formula fails here instead of silently agreeing with itself.
 */

describe('arena geometry', () => {
  it('keeps the playfield inside the logical canvas', () => {
    expect(GAME_WIDTH).toBe(1280);
    expect(GAME_HEIGHT).toBe(720);
    expect(GROUND_Y).toBeLessThan(GAME_HEIGHT);
    expect(ARENA_MIN_X).toBeGreaterThan(0);
    expect(ARENA_MAX_X).toBeLessThan(GAME_WIDTH);
    expect(ARENA_MIN_X).toBeLessThan(ARENA_MAX_X);
  });

  it('leaves room for a fighter hurtbox at either arena edge', () => {
    const halfWidth = FIGHTER_HURTBOX_WIDTH / 2;
    expect(ARENA_MIN_X - halfWidth).toBeGreaterThan(0);
    expect(ARENA_MAX_X + halfWidth).toBeLessThan(GAME_WIDTH);
  });

  it('keeps a standing fighter fully on screen', () => {
    expect(GROUND_Y - FIGHTER_HURTBOX_HEIGHT).toBeGreaterThan(0);
  });
});

describe('physics constants', () => {
  it('pulls fighters down and launches them up', () => {
    expect(GRAVITY).toBeGreaterThan(0);
    expect(JUMP_VELOCITY).toBeLessThan(0);
  });

  it('produces a jump that lands in well under a round', () => {
    // Time to apex, then symmetric fall: 2 * |v| / g.
    const airtimeMs = (2 * Math.abs(JUMP_VELOCITY)) / GRAVITY * 1000;
    expect(airtimeMs).toBeGreaterThan(400);
    expect(airtimeMs).toBeLessThan(1200);
  });

  it('fixes the round length at 60 seconds', () => {
    expect(ROUND_TIME_MS).toBe(60_000);
    // Phase 2 converts this to 3600 ticks at 60 Hz; it must divide evenly.
    expect((ROUND_TIME_MS * 60) % 1000).toBe(0);
  });

  it('buffers a crouch input long enough to chain into an ultimate', () => {
    expect(INPUT_BUFFER_MS).toBe(140);
  });
});

describe('SPEED_BY_STAT', () => {
  it('defines a speed for every stat value the fighters use', () => {
    expect(Object.keys(SPEED_BY_STAT).map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('increases monotonically with the stat', () => {
    const speeds = [1, 2, 3, 4, 5].map((stat) => SPEED_BY_STAT[stat]!);
    expect(speeds).toEqual([235, 255, 280, 310, 340]);
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!);
    }
  });
});

describe('stat multipliers', () => {
  /**
   * Compared with `toBeCloseTo` rather than `toEqual`: `0.85 + 1 * 0.07` is
   * 0.9199999999999999 in IEEE 754, not 0.92. That artifact is harmless for
   * netcode — every client evaluates the identical expression and gets the
   * identical bits — but it does mean these formulas must be carried across to
   * `src/sim/` expression-for-expression. Algebraically rewriting one (say to
   * `(85 + stat * 7) / 100`) changes the low bits and would desync a mixed-version
   * lobby.
   */
  const PRECISION = 12;

  const expectAll = (actual: number[], expected: number[]): void => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, PRECISION));
  };

  it('scales attack damage from 0.92x to 1.20x', () => {
    expectAll([1, 2, 3, 4, 5].map(ATTACK_MULTIPLIER), [0.92, 0.99, 1.06, 1.13, 1.2]);
  });

  it('scales melee reach from 0.935x to 1.155x', () => {
    expectAll([1, 2, 3, 4, 5].map(RANGE_MULTIPLIER), [0.935, 0.99, 1.045, 1.1, 1.155]);
  });

  it('shortens attack recovery as the control stat rises', () => {
    const multipliers = [1, 2, 3, 4, 5].map(CONTROL_RECOVERY_MULTIPLIER);
    expectAll(multipliers, [1.025, 1.0, 0.975, 0.95, 0.925]);
    for (let i = 1; i < multipliers.length; i += 1) {
      expect(multipliers[i]!).toBeLessThan(multipliers[i - 1]!);
    }
  });

  it('never lets a multiplier reach zero or flip sign', () => {
    for (const stat of [1, 2, 3, 4, 5]) {
      expect(ATTACK_MULTIPLIER(stat)).toBeGreaterThan(0);
      expect(RANGE_MULTIPLIER(stat)).toBeGreaterThan(0);
      expect(CONTROL_RECOVERY_MULTIPLIER(stat)).toBeGreaterThan(0);
    }
  });
});
