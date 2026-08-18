import { describe, it, expect } from 'vitest';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../../sim/input';
import { MAX_ENERGY } from '../../sim/constants';
import { checksum, type MatchSetup } from '../../sim/world';
import type { SimWorld } from '../../sim/types';
import { expectAgreement, runMatch } from './linkHarness';

/**
 * The transformation, across a bad link.
 *
 * An install is the only part of this work that reaches into the simulation: it
 * doubles the fighter's hurtbox for eight seconds, so every hit resolved during
 * that window depends on it. Lockstep has no server authority — one tick of
 * disagreement about a box is a match that quietly stops meaning anything — and a
 * desync that only happens after somebody transforms would be invisible in every
 * other test here, because none of the others ever build a full meter.
 *
 * The two clients run the same code, so the risk is not that they compute the box
 * differently in principle. It is that the box is derived from `installTicks`,
 * which is a counter the ultimate sets part-way through its own timeline, in the
 * middle of a freeze — and anything time-shaped is where lockstep bugs live.
 */

const setup = (p1: string, p2: string): MatchSetup => ({
  seed: 20260815,
  p1Character: p1,
  p2Character: p2,
  stage: 'freezer',
});

/**
 * Grant the meter rather than earning it.
 *
 * Applied identically on both clients and derived only from the tick, so it
 * cannot itself be the source of a divergence. Earning it honestly would take
 * twenty seconds of held button per test.
 */
const grantMeterEarly = (world: SimWorld, tick: number): void => {
  if (tick < 110) world.fighters[0].energy = MAX_ENERGY;
};

/** Fire once the round is live, then stand and take it. */
const transformer = (tick: number): InputFrame =>
  tick === 100 ? BUTTON.Ultimate : EMPTY_INPUT;

/** Walk in, then swing at whatever is standing there. */
const aggressor = (tick: number): InputFrame =>
  tick < 260 ? BUTTON.Left
  : tick % 9 === 0 ? BUTTON.Heavy
  : tick % 4 === 0 ? BUTTON.Light
  : BUTTON.Left;

const INSTALLERS: [string, string][] = [
  ['doge', 'sauce'],
  ['goblin', 'salad'],
  ['blade', 'ya'],
  ['pink', 'wizard'],
];

describe('a transformation over a lossy link', () => {
  it.each(INSTALLERS)('keeps %s and %s byte-identical through the install', (p1, p2) => {
    const { a, b } = runMatch({ latencyTicks: 6, jitterTicks: 3, lossRate: 0.05, seed: 29 }, 700, {
      setup: setup(p1, p2),
      scripts: [transformer, aggressor],
      arrange: grantMeterEarly,
    });

    // The test is worthless if the transformation never happened, and it would
    // pass just as loudly — two clients that both did nothing agree perfectly.
    expect(a.world.fighters[0].installTicks, `${p1} never transformed`).toBeGreaterThan(0);

    expectAgreement(a, b);
    expect(a.session.desyncTick).toBeNull();
    expect(b.session.desyncTick).toBeNull();
    expect(checksum(a.world)).toBe(checksum(b.world));
  });

  it('agrees about the damage taken while the body was doubled', () => {
    // The checksum covers this, but a mismatch there says only "somewhere". This
    // says which quantity, which is the difference between a five-minute fix and
    // an afternoon.
    const { a, b } = runMatch({ latencyTicks: 6, jitterTicks: 3, lossRate: 0.05, seed: 31 }, 700, {
      setup: setup('doge', 'sauce'),
      scripts: [transformer, aggressor],
      arrange: grantMeterEarly,
    });

    expect(a.world.fighters[0].hp).toBeLessThan(100);
    expect(a.world.fighters[0].hp).toBe(b.world.fighters[0].hp);
    expect(a.world.fighters[0].installTicks).toBe(b.world.fighters[0].installTicks);
  });
});
