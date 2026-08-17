import { describe, it, expect } from 'vitest';
import type { AttackSpec } from '../../combat/AttackSpec';
import { LIGHT_ATTACK } from '../../combat/AttackSpec';
import { FighterState } from '../../fighters/FighterState';
import { MAX_HP } from '../constants';
import { registerSpec, type TickSpec } from '../attackSpecs';
import {
  consumeArmor,
  hasArmorAgainst,
  hitCategory,
  isInvulnerableTo,
  resolveHit,
} from '../combat';
import { createFighter } from '../fighter';
import { GROUND_Y } from '../constants';
import type { SimEvent, SimFighter } from '../types';
import { attackRuntime } from './factories';

/**
 * Invulnerability, armour, throws and multi-hit — the defensive half of the
 * upgraded build's frame data.
 *
 * These decide whether a hit lands at all, so they sit upstream of the damage
 * formula and are worth pinning down separately from it.
 */

/**
 * Build a spec and put it in the registry, because hit resolution looks the
 * *defender's* current move up by id to find its invulnerability and armour.
 */
const spec = (overrides: Partial<AttackSpec>): TickSpec =>
  registerSpec({ ...LIGHT_ATTACK, ...overrides });

const attacker = (overrides: Partial<SimFighter> = {}): SimFighter => ({
  ...createFighter('collapse', 500, 1),
  ...overrides,
});

const defender = (overrides: Partial<SimFighter> = {}): SimFighter => ({
  ...createFighter('okboss', 560, -1),
  ...overrides,
});

const hit = (a: SimFighter, d: SimFighter, s: TickSpec, tick = 0) => {
  const events: SimEvent[] = [];
  return { result: resolveHit(a, d, s, tick, 0, events), events };
};

describe('hitCategory', () => {
  it('calls a grounded swing a strike and an airborne one an air attack', () => {
    expect(hitCategory(spec({}), false)).toBe('strike');
    expect(hitCategory(spec({}), true)).toBe('airAttack');
  });

  it('calls anything that leaves the fighter a projectile', () => {
    for (const kind of ['sonic', 'water', 'salad', 'beam', 'zone'] as const) {
      expect(hitCategory(spec({ kind }), false), kind).toBe('projectile');
    }
  });

  it('calls an unblockable a throw, whatever else it looks like', () => {
    // Derived, not authored: a move cannot claim a category it does not behave
    // like and slip through the wrong invulnerability window.
    expect(hitCategory(spec({ unblockable: true }), false)).toBe('throw');
    expect(hitCategory(spec({ unblockable: true }), true)).toBe('throw');
  });
});

describe('invulnerability windows', () => {
  // Registered for its side effect; the tests below reference it by id, the way
  // the simulation does.
  spec({ id: 'test-antiair', invulnerable: [{ against: 'airAttack', from: 1, to: 5 }] });

  it('is measured from the first tick of the attack, counting from one', () => {
    const d = defender({ attack: attackRuntime({ specId: 'test-antiair', elapsedTicks: 0 }) });
    expect(isInvulnerableTo(d, 'airAttack')).toBe(true);

    d.attack!.elapsedTicks = 4; // frame 5, the last covered one
    expect(isInvulnerableTo(d, 'airAttack')).toBe(true);

    d.attack!.elapsedTicks = 5; // frame 6
    expect(isInvulnerableTo(d, 'airAttack')).toBe(false);
  });

  it('only covers the category it names', () => {
    const d = defender({ attack: attackRuntime({ specId: 'test-antiair' }) });
    expect(isInvulnerableTo(d, 'airAttack')).toBe(true);
    expect(isInvulnerableTo(d, 'strike')).toBe(false);
    expect(isInvulnerableTo(d, 'projectile')).toBe(false);
  });

  it("covers everything when it says 'all'", () => {
    spec({ id: 'test-dodge', invulnerable: [{ against: 'all', from: 1, to: 3 }] });
    const d = defender({ attack: attackRuntime({ specId: 'test-dodge' }) });
    for (const category of ['strike', 'projectile', 'throw', 'airAttack'] as const) {
      expect(isInvulnerableTo(d, category), category).toBe(true);
    }
  });

  it('is false for a fighter doing nothing at all', () => {
    expect(isInvulnerableTo(defender(), 'strike')).toBe(false);
  });

  it('refuses the hit entirely, leaving no damage and no stun', () => {
    const d = defender({ attack: attackRuntime({ specId: 'test-antiair' }) });
    const a = attacker({ attack: attackRuntime({ airborne: true }) });
    const { result, events } = hit(a, d, spec({}));

    expect(result).toBeNull();
    expect(d.hp).toBe(MAX_HP);
    expect(d.state).not.toBe(FighterState.HITSTUN);
    expect(events).toHaveLength(0);
  });

  it('does not stop a grounded strike from beating the same anti-air', () => {
    const d = defender({ attack: attackRuntime({ specId: 'test-antiair' }) });
    expect(hit(attacker(), d, spec({})).result).not.toBeNull();
    expect(d.hp).toBeLessThan(MAX_HP);
  });
});

describe('armour', () => {
  spec({ id: 'test-armour', armor: { against: 'strike', hits: 1, from: 1, to: 10 } });

  it('absorbs the hit: damage lands, the attack carries on', () => {
    const d = defender({
      state: FighterState.SPECIAL,
      attack: attackRuntime({ specId: 'test-armour' }),
    });
    const { result } = hit(attacker(), d, spec({}));

    expect(result?.armored).toBe(true);
    expect(d.hp).toBeLessThan(MAX_HP);
    // The whole point: not interrupted.
    expect(d.state).toBe(FighterState.SPECIAL);
    expect(d.attack).not.toBeNull();
    expect(d.vx).toBe(0);
  });

  it('is spent after the number of hits it declares', () => {
    const d = defender({
      state: FighterState.SPECIAL,
      attack: attackRuntime({ specId: 'test-armour' }),
    });
    expect(hasArmorAgainst(d, 'strike')).toBe(true);
    consumeArmor(d);
    expect(hasArmorAgainst(d, 'strike')).toBe(false);
  });

  it('lets the next hit through once spent', () => {
    const d = defender({
      state: FighterState.SPECIAL,
      attack: attackRuntime({ specId: 'test-armour' }),
    });
    hit(attacker(), d, spec({}));
    expect(d.state).toBe(FighterState.SPECIAL);

    const second = hit(attacker(), d, spec({}));
    expect(second.result?.armored).toBe(false);
    expect(d.state).toBe(FighterState.HITSTUN);
  });

  it('does not apply outside its window', () => {
    const d = defender({
      attack: attackRuntime({ specId: 'test-armour', elapsedTicks: 10 }), // frame 11
    });
    expect(hasArmorAgainst(d, 'strike')).toBe(false);
  });

  it('never stops a throw, which is what armour is supposed to lose to', () => {
    const d = defender({
      attack: attackRuntime({ specId: 'test-armour' }),
    });
    expect(hasArmorAgainst(d, 'throw')).toBe(false);

    const { result } = hit(attacker(), d, spec({ unblockable: true }));
    expect(result?.armored).toBe(false);
    expect(d.state).toBe(FighterState.HITSTUN);
  });

  it('still lets a hit that would KO put the fighter down', () => {
    const d = defender({
      hp: 0.5,
      state: FighterState.SPECIAL,
      attack: attackRuntime({ specId: 'test-armour' }),
    });
    hit(attacker(), d, spec({}));
    expect(d.hp).toBe(0);
    expect(d.state).toBe(FighterState.KO);
  });
});

describe('throws', () => {
  const command = spec({ id: 'test-throw', unblockable: true, hardKnockdown: true });

  it('ignores a block', () => {
    const d = defender({ state: FighterState.BLOCK, guardHeld: true });
    const { result } = hit(attacker(), d, command);
    expect(result?.blocked).toBe(false);
    expect(d.state).toBe(FighterState.HITSTUN);
  });

  it('cannot catch an airborne defender', () => {
    const d = defender({ y: GROUND_Y - 200 });
    expect(hit(attacker(), d, command).result).toBeNull();
    expect(d.hp).toBe(MAX_HP);
  });

  it('keeps the defender down longer than a normal hit', () => {
    const soft = defender();
    const hard = defender();
    hit(attacker(), soft, spec({ id: 'test-soft' }));
    hit(attacker(), hard, command);
    expect(hard.stateRemainingTicks).toBeGreaterThan(soft.stateRemainingTicks);
  });

  it('is still blockable when it is not declared unblockable', () => {
    const d = defender({ state: FighterState.BLOCK, guardHeld: true });
    expect(hit(attacker(), d, spec({})).result?.blocked).toBe(true);
  });
});

describe('multi-hit specs', () => {
  it('resolves a single-hit attack as a one-entry list, so the path never branches', () => {
    expect(spec({ damage: 7 }).hits).toEqual([7]);
    expect(spec({ damage: 7 }).rehitTicks).toBe(0);
  });

  it('deals each authored hit in turn', () => {
    const multi = spec({ id: 'test-multi', damage: 10, hits: [3, 3, 4], rehitTicks: 4 });
    const a = attacker({ attack: attackRuntime({ specId: 'test-multi' }) });

    const damages: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      a.attack!.hitsUsed = i;
      const d = defender();
      hit(a, d, multi);
      damages.push(+(MAX_HP - d.hp).toFixed(6));
    }

    // 3, 3, 4 scaled by the same stat multipliers, so the ratios survive.
    expect(damages[0]).toBe(damages[1]);
    expect(damages[2]).toBeGreaterThan(damages[1]!);
  });

  it('clamps to the last entry rather than dealing undefined damage', () => {
    // Belt and braces: the caller stops at hits.length, but a spec whose damage
    // list is shorter than its hit count must not produce NaN health.
    const multi = spec({ id: 'test-multi2', damage: 6, hits: [3, 3], rehitTicks: 4 });
    const a = attacker({ attack: attackRuntime({ specId: 'test-multi2', hitsUsed: 9 }) });
    const d = defender();
    hit(a, d, multi);
    expect(Number.isFinite(d.hp)).toBe(true);
    expect(d.hp).toBeLessThan(MAX_HP);
  });
});
