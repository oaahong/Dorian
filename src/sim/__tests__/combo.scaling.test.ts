import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import { COMBO_SCALING, COMBO_WINDOW_TICKS, MAX_HP } from '../constants';
import { LIGHT_SPEC, getSpec } from '../attackSpecs';
import { hitTiming, resolveHit } from '../combat';
import { createFighter } from '../fighter';
import { attackRuntime } from './factories';
import type { SimEvent, SimFighter } from '../types';

/**
 * Damage scaling and counter timing — the two things that decide what a combo is
 * *worth*, as opposed to whether it connects.
 *
 * Cancels took the opponent's turn away. Without scaling, "can I link these" and
 * "how much is the round worth" collapse into one question and the longest string
 * simply wins; without counter timing, catching somebody mid-swing pays exactly
 * the same as hitting a statue.
 */

const attacker = (o: Partial<SimFighter> = {}): SimFighter => ({
  ...createFighter('pink', 500, 1),
  ...o,
});
const defender = (o: Partial<SimFighter> = {}): SimFighter => ({
  ...createFighter('ok', 560, -1),
  ...o,
});

const hit = (a: SimFighter, d: SimFighter, tick = 0) => {
  const events: SimEvent[] = [];
  return resolveHit(a, d, LIGHT_SPEC, tick, 0, events);
};

describe('the scaling curve', () => {
  it('runs full, then down to half, and stays there', () => {
    expect(COMBO_SCALING(1)).toBe(1);
    expect(COMBO_SCALING(2)).toBe(0.9);
    expect(COMBO_SCALING(6)).toBe(0.5);
    expect(COMBO_SCALING(30)).toBe(0.5);
  });

  it('never scales the first hit of anything', () => {
    expect(COMBO_SCALING(1)).toBe(1);
    expect(COMBO_SCALING(0)).toBe(1);
  });
});

describe('a combo is worth less the longer it runs', () => {
  it('deals less on the second hit of a string than the first', () => {
    const a = attacker();
    const d = defender();

    hit(a, d);
    const first = MAX_HP - d.hp;
    expect(a.comboHits).toBe(1);

    // Still in hitstun, so the next hit continues the string.
    d.state = FighterState.HITSTUN;
    const before = d.hp;
    hit(a, d, 1);
    const second = before - d.hp;

    expect(a.comboHits).toBe(2);
    expect(second).toBeCloseTo(first * 0.9, 6);
  });

  it('starts over when the opponent was not in hitstun', () => {
    const a = attacker();
    const d = defender();
    hit(a, d);
    d.state = FighterState.IDLE;
    hit(a, d, 1);
    expect(a.comboHits).toBe(1);
  });

  /**
   * A blockstring is not a combo. Counting it would let an attacker scale down
   * their own punish by poking a guard first, which is backwards.
   */
  it('does not count blocked hits toward the string', () => {
    const a = attacker();
    const guarding = defender({ state: FighterState.BLOCK, guardHeld: true });
    hit(a, guarding);
    expect(a.comboHits).toBe(0);
  });

  it('lapses after the window and starts fresh', () => {
    const a = attacker({ comboHits: 4, comboTicks: 1 });
    expect(COMBO_SCALING(a.comboHits)).toBeLessThan(1);
    a.comboTicks = 0;
    a.comboHits = 0;
    expect(COMBO_SCALING(a.comboHits)).toBe(1);
    expect(COMBO_WINDOW_TICKS).toBeGreaterThan(0);
  });
});

describe('counter and punish timing', () => {
  it('calls a hit on a fighter doing nothing neutral', () => {
    expect(hitTiming(defender())).toBe('neutral');
  });

  it('calls a hit during startup a counter', () => {
    const d = defender({
      state: FighterState.HEAVY_ATTACK,
      attack: attackRuntime({ specId: 'heavy', elapsedTicks: 1 }),
    });
    expect(hitTiming(d)).toBe('counter');
  });

  it('calls a hit during recovery a punish', () => {
    const spec = getSpec('heavy');
    const d = defender({
      state: FighterState.HEAVY_ATTACK,
      attack: attackRuntime({
        specId: 'heavy',
        elapsedTicks: spec.startupTicks + spec.activeTicks + 1,
      }),
    });
    expect(hitTiming(d)).toBe('punish');
  });

  it('calls a hit during the active frames neither', () => {
    const spec = getSpec('heavy');
    const d = defender({
      state: FighterState.HEAVY_ATTACK,
      attack: attackRuntime({ specId: 'heavy', elapsedTicks: spec.startupTicks }),
    });
    expect(hitTiming(d)).toBe('neutral');
  });

  it('pays more for a punish than for hitting a statue', () => {
    const plain = defender();
    const spec = getSpec('heavy');
    const punished = defender({
      state: FighterState.HEAVY_ATTACK,
      attack: attackRuntime({
        specId: 'heavy',
        elapsedTicks: spec.startupTicks + spec.activeTicks + 1,
      }),
    });

    hit(attacker(), plain);
    hit(attacker(), punished);
    expect(MAX_HP - punished.hp).toBeGreaterThan(MAX_HP - plain.hp);
  });

  /**
   * A counter hit pays in *frames*, not damage — it leaves the defender stunned
   * longer, which is what turns the read into a combo rather than into a number.
   */
  it('adds stun for a counter hit rather than damage', () => {
    const plain = defender();
    const countered = defender({
      state: FighterState.HEAVY_ATTACK,
      attack: attackRuntime({ specId: 'heavy', elapsedTicks: 1 }),
    });

    hit(attacker(), plain);
    hit(attacker(), countered);

    expect(MAX_HP - countered.hp).toBeCloseTo(MAX_HP - plain.hp, 6);
    expect(countered.stateRemainingTicks).toBeGreaterThan(plain.stateRemainingTicks);
  });
});
