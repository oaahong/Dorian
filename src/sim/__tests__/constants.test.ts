import { describe, it, expect } from 'vitest';
import {
  DT,
  ENDING_TICKS,
  INPUT_BUFFER_TICKS,
  INTRO_TICKS,
  ROUND_CALL_TICKS,
  ROUND_TICKS,
  STUN_FRICTION_PER_TICK,
  TICK_HZ,
  TICK_MS,
  msToTicks,
} from '../constants';

describe('tick conversion', () => {
  it('runs the simulation at 60 Hz with a constant timestep', () => {
    expect(TICK_HZ).toBe(60);
    expect(DT).toBe(1 / 60);
    expect(TICK_MS).toBeCloseTo(16.6666666, 6);
  });

  it('rounds authored millisecond durations to whole ticks', () => {
    // Frame data is authored in ms; these are the conversions the ported
    // AttackSpecs depend on. Rounding shifts a few windows by up to 8 ms, which
    // is the deliberate one-off balance change noted in the plan.
    expect(msToTicks(0)).toBe(0);
    expect(msToTicks(90)).toBe(5); // LIGHT startup: 90 ms -> 83.3 ms
    expect(msToTicks(180)).toBe(11); // HEAVY startup
    expect(msToTicks(160)).toBe(10);
    expect(msToTicks(1000)).toBe(60);
  });

  it('derives the round and menu timings', () => {
    expect(ROUND_TICKS).toBe(3600);
    expect(ROUND_CALL_TICKS).toBe(37);
    expect(INTRO_TICKS).toBe(67);
    expect(ENDING_TICKS).toBe(141);
    expect(INPUT_BUFFER_TICKS).toBe(8);
  });

  it('keeps the intro ordered: round call, then hand over control', () => {
    expect(ROUND_CALL_TICKS).toBeLessThan(INTRO_TICKS);
  });
});

describe('STUN_FRICTION_PER_TICK', () => {
  /**
   * The literal replaces `Math.pow(0.0015, dt)` in the hot path. `Math.pow` is
   * implementation-defined to within an ULP or so across JavaScript engines, and
   * a single differing bit in a fighter's velocity is a desync. This test is the
   * only place the two are allowed to meet.
   */
  it('equals Math.pow(0.0015, 1 / 60)', () => {
    expect(STUN_FRICTION_PER_TICK).toBe(Math.pow(0.0015, 1 / 60));
  });

  it('decays velocity but never reverses or zeroes it in one tick', () => {
    expect(STUN_FRICTION_PER_TICK).toBeGreaterThan(0);
    expect(STUN_FRICTION_PER_TICK).toBeLessThan(1);
  });

  it('bleeds off knockback in roughly a third of a second', () => {
    // 20 ticks of decay should leave under 15% of the original velocity.
    const after20Ticks = STUN_FRICTION_PER_TICK ** 20;
    expect(after20Ticks).toBeLessThan(0.15);
    expect(after20Ticks).toBeGreaterThan(0.05);
  });
});
