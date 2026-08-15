import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import { MAX_ENERGY, MAX_HP } from '../constants';
import { getSpec, HEAVY_SPEC, LIGHT_SPEC } from '../attackSpecs';
import { createFighter } from '../fighter';
import { addEnergy, canBlockImpact, receiveImpact, resolveHit } from '../combat';
import type { SimEvent, SimFighter } from '../types';

/** Hit resolution, ported from CombatSystem.resolveHit. See docs/sim-spec.md §7. */

const attacker = (overrides: Partial<SimFighter> = {}): SimFighter => ({
  ...createFighter('collapse', 500, 1), // attackStat 5 -> 1.2x
  ...overrides,
});

const defender = (overrides: Partial<SimFighter> = {}): SimFighter => ({
  ...createFighter('okboss', 560, -1), // hpStat 4 -> 0.96x mitigation
  ...overrides,
});

const hit = (a: SimFighter, d: SimFighter, spec = LIGHT_SPEC, tick = 0) => {
  const events: SimEvent[] = [];
  const result = resolveHit(a, d, spec, tick, 0, events);
  return { result, events };
};

describe('damage formula', () => {
  it('scales the spec damage by attack stat and defender HP stat', () => {
    const a = attacker();
    const d = defender();
    hit(a, d);
    // 5 damage * 1.2 (attackStat 5) * 0.96 (hpStat 4) = 5.76
    expect(MAX_HP - d.hp).toBeCloseTo(5 * (0.85 + 5 * 0.07) * (1.08 - 4 * 0.03), 10);
  });

  it('hits harder from a higher attack stat', () => {
    const weak = defender();
    const strong = defender();
    hit(attacker({ configId: 'cry' }), weak); // attackStat 2
    hit(attacker({ configId: 'collapse' }), strong); // attackStat 5
    expect(strong.hp).toBeLessThan(weak.hp);
  });

  it('takes less from a higher HP stat', () => {
    const tanky = defender({ configId: 'salad' }); // hpStat 5
    const frail = defender({ configId: 'cry' }); // hpStat 2
    hit(attacker(), tanky);
    hit(attacker(), frail);
    expect(tanky.hp).toBeGreaterThan(frail.hp);
  });

  it('never drives hp below zero', () => {
    const d = defender({ hp: 1 });
    hit(attacker(), d, HEAVY_SPEC);
    expect(d.hp).toBe(0);
  });

  it('ignores a hit on an already knocked-out defender', () => {
    const d = defender({ hp: 0, state: FighterState.KO });
    const { result } = hit(attacker(), d);
    expect(result).toBeNull();
    expect(d.hp).toBe(0);
  });
});

describe('blocking', () => {
  const guarding = (overrides: Partial<SimFighter> = {}) =>
    defender({ guardHeld: true, state: FighterState.BLOCK, ...overrides });

  it('reduces damage to the chip ratio', () => {
    const spec = getSpec('collapse-special'); // chipRatio 0.10
    const open = defender();
    const blocking = guarding();
    hit(attacker(), open, spec);
    hit(attacker(), blocking, spec);
    expect(MAX_HP - blocking.hp).toBeCloseTo((MAX_HP - open.hp) * 0.1, 8);
  });

  it('deals nothing at all against a normal, which has no chip', () => {
    const blocking = guarding();
    hit(attacker(), blocking, LIGHT_SPEC);
    expect(blocking.hp).toBe(MAX_HP);
  });

  it('puts the defender in blockstun rather than hitstun', () => {
    const blocking = guarding();
    hit(attacker(), blocking);
    expect(blocking.state).toBe(FighterState.BLOCKSTUN);
    expect(blocking.stateRemainingTicks).toBe(LIGHT_SPEC.blockstunTicks);
  });

  it('cuts knockback to a quarter and removes the launch', () => {
    const open = defender();
    const blocking = guarding();
    hit(attacker(), open, HEAVY_SPEC);
    hit(attacker(), blocking, HEAVY_SPEC);
    expect(blocking.vx).toBeCloseTo(open.vx * 0.24, 10);
    expect(blocking.vy).toBe(0);
    expect(open.vy).toBe(HEAVY_SPEC.knockbackY);
  });

  it('gives a shorter hit-stop than a clean hit', () => {
    const { result: blocked } = hit(attacker(), guarding());
    const { result: clean } = hit(attacker(), defender());
    expect(blocked!.hitStopTicks).toBeLessThan(clean!.hitStopTicks);
  });
});

describe('canBlockImpact', () => {
  it('accepts an explicit block stance', () => {
    expect(canBlockImpact(defender({ state: FighterState.BLOCK }))).toBe(true);
    expect(canBlockImpact(defender({ state: FighterState.BLOCKSTUN }))).toBe(true);
  });

  it('accepts a grounded fighter merely holding away', () => {
    // guardHeld has no range condition — see docs/sim-spec.md §5.
    expect(canBlockImpact(defender({ guardHeld: true, state: FighterState.WALK }))).toBe(true);
  });

  it('rejects a fighter that is not guarding', () => {
    expect(canBlockImpact(defender({ guardHeld: false }))).toBe(false);
  });

  it('rejects guarding in the air', () => {
    expect(canBlockImpact(defender({ guardHeld: true, y: 400 }))).toBe(false);
  });

  it('rejects guarding while attacking', () => {
    expect(
      canBlockImpact(defender({ guardHeld: true, state: FighterState.HEAVY_ATTACK })),
    ).toBe(false);
  });

  it.each([FighterState.HITSTUN, FighterState.KO, FighterState.VICTORY])(
    'rejects guarding in %s',
    (state) => {
      expect(canBlockImpact(defender({ guardHeld: true, state }))).toBe(false);
    },
  );
});

describe('meter', () => {
  it('rewards both fighters on a clean hit', () => {
    const a = attacker();
    const d = defender();
    hit(a, d);
    expect(a.energy).toBe(LIGHT_SPEC.energyOnHit);
    expect(d.energy).toBe(LIGHT_SPEC.energyOnReceive);
  });

  it('gives a reduced share on a blocked hit that deals chip', () => {
    const spec = getSpec('collapse-special');
    const a = attacker();
    const d = defender({ guardHeld: true, state: FighterState.BLOCK });
    hit(a, d, spec);
    expect(a.energy).toBe(Math.ceil(spec.energyOnHit * 0.35));
    expect(d.energy).toBe(Math.ceil(spec.energyOnReceive * 0.35));
  });

  it('gives nothing when a blocked attack has no chip', () => {
    const a = attacker();
    const d = defender({ guardHeld: true, state: FighterState.BLOCK });
    hit(a, d, LIGHT_SPEC);
    expect(a.energy).toBe(0);
    expect(d.energy).toBe(0);
  });

  it('clamps the meter to its maximum', () => {
    const f = defender({ energy: 98 });
    addEnergy(f, 50);
    expect(f.energy).toBe(MAX_ENERGY);
  });

  it('clamps the meter at zero', () => {
    const f = defender({ energy: 5 });
    addEnergy(f, -50);
    expect(f.energy).toBe(0);
  });
});

describe('receiveImpact', () => {
  it('cancels the defender’s own attack', () => {
    const d = defender({
      state: FighterState.HEAVY_ATTACK,
      attack: {
        specId: HEAVY_SPEC.id, kind: 'melee', elapsedTicks: 4,
        activeJustStarted: false, crouching: false, airborne: false, hitMask: 0,
      },
    });
    receiveImpact(d, 5, LIGHT_SPEC, 1, false, 0);
    expect(d.attack).toBeNull();
    expect(d.state).toBe(FighterState.HITSTUN);
  });

  it('knocks the defender in the attacker’s facing direction', () => {
    const right = defender();
    const left = defender();
    receiveImpact(right, 5, LIGHT_SPEC, 1, false, 0);
    receiveImpact(left, 5, LIGHT_SPEC, -1, false, 0);
    expect(right.vx).toBe(LIGHT_SPEC.knockbackX);
    expect(left.vx).toBe(-LIGHT_SPEC.knockbackX);
  });

  it('applies the full hitstun of the spec', () => {
    const d = defender();
    receiveImpact(d, 5, HEAVY_SPEC, 1, false, 0);
    expect(d.stateRemainingTicks).toBe(HEAVY_SPEC.hitstunTicks);
  });

  describe('knockout', () => {
    it('overrides stun with a KO and a bigger launch', () => {
      const d = defender({ hp: 1 });
      receiveImpact(d, 50, LIGHT_SPEC, 1, false, 0);
      expect(d.state).toBe(FighterState.KO);
      expect(d.stateRemainingTicks).toBe(0);
      // KO launch is at least 420 horizontally and -260 vertically.
      expect(d.vx).toBeGreaterThanOrEqual(420);
      expect(d.vy).toBeLessThanOrEqual(-260);
    });

    it('scales the KO launch up for a heavier attack', () => {
      const light = defender({ hp: 1 });
      const heavy = defender({ hp: 1 });
      receiveImpact(light, 50, LIGHT_SPEC, 1, false, 0);
      receiveImpact(heavy, 50, getSpec('collapse-ult'), 1, false, 0);
      expect(heavy.vx).toBeGreaterThan(light.vx);
    });

    it('cannot be knocked out twice', () => {
      const d = defender({ hp: 0, state: FighterState.KO, vx: 0 });
      receiveImpact(d, 50, HEAVY_SPEC, 1, false, 0);
      expect(d.vx).toBe(0);
    });
  });

  describe('aura stun lock-out', () => {
    const AURA = getSpec('awkward-special'); // kind: 'aura', stunLockoutMs 2800

    it('applies the full stun the first time', () => {
      const d = defender();
      receiveImpact(d, 5, AURA, 1, false, 100);
      expect(d.stateRemainingTicks).toBe(AURA.hitstunTicks);
      expect(d.stunLockoutUntilTick).toBe(100 + AURA.stunLockoutTicks);
    });

    it('caps the stun while the lock-out is active', () => {
      const d = defender({ stunLockoutUntilTick: 500 });
      receiveImpact(d, 5, AURA, 1, false, 100);
      // Capped at 180 ms worth of ticks.
      expect(d.stateRemainingTicks).toBe(11);
      expect(d.stateRemainingTicks).toBeLessThan(AURA.hitstunTicks);
    });

    it('does not extend the lock-out while it is already running', () => {
      const d = defender({ stunLockoutUntilTick: 500 });
      receiveImpact(d, 5, AURA, 1, false, 100);
      expect(d.stunLockoutUntilTick).toBe(500);
    });

    it('re-arms once the lock-out has expired', () => {
      const d = defender({ stunLockoutUntilTick: 50 });
      receiveImpact(d, 5, AURA, 1, false, 100);
      expect(d.stateRemainingTicks).toBe(AURA.hitstunTicks);
      expect(d.stunLockoutUntilTick).toBe(100 + AURA.stunLockoutTicks);
    });

    it('leaves non-aura attacks unaffected by the lock-out', () => {
      const d = defender({ stunLockoutUntilTick: 500 });
      receiveImpact(d, 5, HEAVY_SPEC, 1, false, 100);
      expect(d.stateRemainingTicks).toBe(HEAVY_SPEC.hitstunTicks);
    });
  });
});

describe('hit events', () => {
  it('reports a clean hit with its impact weight', () => {
    const { events } = hit(attacker(), defender(), HEAVY_SPEC);
    expect(events).toContainEqual(
      expect.objectContaining({ t: 'hit', player: 0, impact: 'heavy', blocked: false }),
    );
  });

  it('reports a blocked hit', () => {
    const d = defender({ guardHeld: true, state: FighterState.BLOCK });
    const { events } = hit(attacker(), d);
    expect(events).toContainEqual(expect.objectContaining({ t: 'hit', blocked: true }));
  });

  it('classifies specials and ultimates by weight', () => {
    const special = hit(attacker(), defender(), getSpec('collapse-special'));
    const ultimate = hit(attacker(), defender(), getSpec('collapse-ult'));
    expect(special.events[0]).toMatchObject({ impact: 'special' });
    expect(ultimate.events[0]).toMatchObject({ impact: 'ultimate' });
  });
});
