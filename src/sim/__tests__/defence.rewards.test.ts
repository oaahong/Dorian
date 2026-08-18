import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import { MAX_ENERGY, THROW_TECH_TICKS, ULTIMATE_CHARGE_PER_TICK } from '../constants';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../input';
import { THROW_SPEC, getSpec } from '../attackSpecs';
import { resolveHit } from '../combat';
import { createFighter, stepFighter } from '../fighter';
import { attackRuntime } from './factories';
import type { SimEvent, SimFighter } from '../types';

/**
 * What defending *earns*.
 *
 * Every one of these exists because the defensive option was otherwise strictly
 * worse than blocking: a parry has a tighter window and a longer recovery for the
 * same outcome, armour lets the damage land, and being thrown had no answer at
 * all. Without a reward, the correct play is always to hold back.
 */

const attacker = (o: Partial<SimFighter> = {}): SimFighter => ({
  ...createFighter('pink', 500, 1),
  ...o,
});
const defender = (o: Partial<SimFighter> = {}): SimFighter => ({
  ...createFighter('ok', 560, -1),
  ...o,
});

const hit = (a: SimFighter, d: SimFighter, specId = 'light', tick = 0) => {
  const events: SimEvent[] = [];
  const result = resolveHit(a, d, getSpec(specId), tick, 0, events);
  return { result, events };
};

describe('the throw escape', () => {
  it('refuses a throw when the victim also reached for one', () => {
    const d = defender({ lastThrowPressTick: 0 });
    const { result, events } = hit(attacker(), d, THROW_SPEC.id, THROW_TECH_TICKS);
    expect(result).toBeNull();
    expect(d.hp).toBe(100);
    expect(events).toContainEqual({ t: 'throwTech', player: 0 });
  });

  it('pushes both of them apart rather than leaving them touching', () => {
    const a = attacker();
    const d = defender({ lastThrowPressTick: 0 });
    hit(a, d, THROW_SPEC.id, 1);
    expect(a.vx).toBeLessThan(0); // a is on the left, pushed left
    expect(d.vx).toBeGreaterThan(0);
  });

  it('lets the throw land when the reach was too long ago', () => {
    const d = defender({ lastThrowPressTick: 0 });
    const { result } = hit(attacker(), d, THROW_SPEC.id, THROW_TECH_TICKS + 1);
    expect(result).not.toBeNull();
    expect(d.hp).toBeLessThan(100);
  });

  /** Holding the button must not be an answer to being thrown. */
  it('is not satisfied by a press that never happened', () => {
    const { result } = hit(attacker(), defender(), THROW_SPEC.id, 300);
    expect(result).not.toBeNull();
  });
});

describe('reading an attack pays', () => {
  it('gives meter for a parry that refused a hit', () => {
    const d = defender({
      state: FighterState.SPECIAL,
      attack: attackRuntime({ specId: 'ya-glasses', elapsedTicks: 3 }),
    });
    hit(attacker(), d);
    expect(d.energy).toBeGreaterThan(0);
  });

  it('gives meter for hiding from a projectile', () => {
    const d = defender({
      state: FighterState.SPECIAL,
      attack: attackRuntime({ specId: 'scared-box', elapsedTicks: 8 }),
    });
    hit(attacker(), d, 'ya-hi');
    expect(d.energy).toBeGreaterThan(0);
  });

  /**
   * Invulnerability that is a *side effect* of an offensive move is not a read.
   * An anti-air already gets to hit you; paying it again would make the reward
   * meaningless.
   */
  it('pays nothing for invulnerability that came free with an attack', () => {
    // An ultimate's startup is invulnerable to everything, and it is emphatically
    // not a read — it already gets to hit you.
    const d = defender({
      state: FighterState.ULTIMATE,
      attack: attackRuntime({ specId: 'ok-ult', elapsedTicks: 1 }),
    });
    hit(attacker(), d);
    expect(d.energy).toBe(0);
  });

  it('gives meter for absorbing a hit on armour', () => {
    const d = defender({
      state: FighterState.SPECIAL,
      attack: attackRuntime({ specId: 'doge-bread', elapsedTicks: 8 }),
    });
    hit(attacker(), d);
    expect(d.energy).toBeGreaterThan(0);
    expect(d.hp).toBeLessThan(100); // armour is not invulnerability
  });
});

describe('holding the ultimate button', () => {
  function run(f: SimFighter, input: InputFrame, ticks: number): void {
    const opponent = createFighter('ok', 900, -1);
    for (let i = 0; i < ticks; i += 1) stepFighter(f, opponent, input, i, true, 0, []);
  }

  it('builds the bar slowly rather than not at all', () => {
    const f = attacker();
    run(f, BUTTON.Ultimate, 60);
    expect(f.energy).toBeCloseTo(ULTIMATE_CHARGE_PER_TICK * 60, 6);
    expect(f.energy).toBeCloseTo(5, 6); // five a second
  });

  it('builds nothing while the button is untouched', () => {
    const f = attacker();
    run(f, EMPTY_INPUT, 60);
    expect(f.energy).toBe(0);
  });

  /**
   * The tick the bar fills must not be the tick the ultimate comes out — that
   * would spend the meter the player was still building, at a moment the game
   * chose rather than they did.
   */
  it('will not fire on the same hold that filled the bar', () => {
    const f = attacker({ energy: MAX_ENERGY - 1 });
    run(f, BUTTON.Ultimate, 90);
    expect(f.energy).toBe(MAX_ENERGY);
    expect(f.ultimateNeedsRelease).toBe(true);
    expect(f.state).not.toBe(FighterState.ULTIMATE);
  });

  it('fires once the button has been let go and pressed again', () => {
    const f = attacker({ energy: MAX_ENERGY - 1 });
    run(f, BUTTON.Ultimate, 90);
    run(f, EMPTY_INPUT, 2);
    expect(f.ultimateNeedsRelease).toBe(false);
    run(f, BUTTON.Ultimate, 1);
    expect(f.state).toBe(FighterState.ULTIMATE);
  });
});
