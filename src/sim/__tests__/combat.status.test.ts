import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../input';
import {
  INSTALL_DAMAGE_MULTIPLIER,
  MAX_ENERGY,
  MAX_HP,
  P1_SPAWN_X,
  SLOW_MOVE_MULTIPLIER,
  SPEED_BY_STAT,
} from '../constants';
import { LIGHT_SPEC, getSpec } from '../attackSpecs';
import { resolveHit } from '../combat';
import { createFighter, stepFighter } from '../fighter';
import { checksum, createWorld, stepWorld, type MatchSetup } from '../world';
import type { SimEvent, SimFighter, SimWorld } from '../types';

/**
 * Installs, slows and summons — the timed effects and the multi-entity move.
 *
 * All three are simulation state and all three are hashed, so a client that read
 * them differently would desync rather than merely look wrong.
 */

const SETUP: MatchSetup = {
  seed: 20260817,
  p1Character: 'tempura',
  p2Character: 'ok',
  stage: 'freezer',
};

const world = (setup: Partial<MatchSetup> = {}): SimWorld => createWorld({ ...SETUP, ...setup });

function run(w: SimWorld, ticks: number, p1: InputFrame = EMPTY_INPUT, p2: InputFrame = EMPTY_INPUT) {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i += 1) events.push(...stepWorld(w, [p1, p2]));
  return events;
}

function toFight(w: SimWorld): SimWorld {
  while (w.phase !== 'fight') stepWorld(w, [EMPTY_INPUT, EMPTY_INPUT]);
  return w;
}

/** Walk in a 236 and press the button. */
function quarterForward(w: SimWorld) {
  run(w, 1, BUTTON.Down);
  run(w, 1, BUTTON.Down | BUTTON.Right);
  run(w, 1, BUTTON.Right);
  run(w, 1, BUTTON.Special);
}

describe('summons', () => {
  it('puts out a whole column at once', () => {
    const w = toFight(world());
    quarterForward(w);
    run(w, 24);
    expect(w.projectiles).toHaveLength(getSpec('tempura-penguins').projectileCount);
    expect(getSpec('tempura-penguins').projectileCount).toBeGreaterThan(1);
  });

  it('spaces them out behind each other rather than stacking them', () => {
    // Stacked, they would be one wide hitbox that all connects on the same tick,
    // which is not what a column of penguins is for.
    const w = toFight(world());
    quarterForward(w);
    run(w, 24);
    const xs = w.projectiles.map((p) => p.x);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('gives every member its own identity and hit mask', () => {
    const w = toFight(world());
    quarterForward(w);
    run(w, 24);
    const ids = w.projectiles.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const projectile of w.projectiles) expect(projectile.hitMask).toBe(0);
  });

  it('leaves an ordinary fireball a single projectile', () => {
    const w = toFight(world({ p1Character: 'pink' }));
    quarterForward(w);
    run(w, 24);
    expect(w.projectiles).toHaveLength(1);
  });
});

describe('the install buff', () => {
  const attacker = (overrides: Partial<SimFighter> = {}): SimFighter => ({
    ...createFighter('goblin', 500, 1),
    ...overrides,
  });
  const defender = (): SimFighter => createFighter('ok', 560, -1);

  const damageDealt = (a: SimFighter) => {
    const d = defender();
    resolveHit(a, d, LIGHT_SPEC, 0, 0, []);
    return MAX_HP - d.hp;
  };

  it('multiplies damage while it lasts', () => {
    const plain = damageDealt(attacker());
    const installed = damageDealt(attacker({ installTicks: 100 }));
    expect(installed / plain).toBeCloseTo(INSTALL_DAMAGE_MULTIPLIER, 10);
  });

  it('stops mattering once it runs out', () => {
    expect(damageDealt(attacker({ installTicks: 0 }))).toBeCloseTo(damageDealt(attacker()), 10);
  });

  it('counts down a tick at a time', () => {
    const self = attacker({ installTicks: 3 });
    const opponent = defender();
    for (let i = 0; i < 3; i += 1) stepFighter(self, opponent, EMPTY_INPUT, i, true, 0, []);
    expect(self.installTicks).toBe(0);
  });

  it('never goes negative, so it cannot wrap into a permanent buff', () => {
    const self = attacker({ installTicks: 1 });
    const opponent = defender();
    for (let i = 0; i < 20; i += 1) stepFighter(self, opponent, EMPTY_INPUT, i, true, 0, []);
    expect(self.installTicks).toBe(0);
  });

  it('is granted by seeing the move through, not by landing it', () => {
    // 瀏海降臨 has no hitbox at all, so completion is the only thing it could key on.
    const w = toFight(world({ p1Character: 'goblin' }));
    run(w, 1, BUTTON.Down);
    run(w, 1, EMPTY_INPUT);
    run(w, 1, BUTTON.Down);
    run(w, 1, BUTTON.Special);
    expect(w.fighters[0].attack?.specId).toBe('goblin-bangs');
    expect(w.fighters[0].installTicks).toBe(0);

    run(w, 40);
    expect(w.fighters[0].installTicks).toBeGreaterThan(0);
  });

  it('is cleared by a new round rather than carried into it', () => {
    const w = toFight(world({ p1Character: 'goblin' }));
    w.fighters[0].installTicks = 200;
    w.fighters[1].hp = 0;
    run(w, 400);
    expect(w.fighters[0].installTicks).toBe(0);
  });
});

describe('the movement slow', () => {
  it('is left behind by a clean hit that carries one', () => {
    const w = toFight(world({ p1Character: 'sauce' }));
    w.fighters[1].x = 600;
    quarterForward(w);
    run(w, 40);
    expect(w.fighters[1].slowTicks).toBeGreaterThan(0);
  });

  it('is not applied by a blocked hit', () => {
    // Chipping someone's guard should not also glue their feet down.
    const w = toFight(world({ p1Character: 'sauce' }));
    w.fighters[1].x = 600;
    quarterForward(w);
    run(w, 40, EMPTY_INPUT, BUTTON.Right); // P2 holds away from P1: blocking
    expect(w.fighters[1].slowTicks).toBe(0);
  });

  it('slows the walk while it lasts, and not after', () => {
    const self = { ...createFighter('scared', P1_SPAWN_X, 1), slowTicks: 3 };
    const opponent = createFighter('ok', 700, -1);
    const full = SPEED_BY_STAT[5]!;

    stepFighter(self, opponent, BUTTON.Right, 0, true, 0, []);
    expect(self.vx).toBeCloseTo(full * SLOW_MOVE_MULTIPLIER, 10);

    for (let i = 1; i < 4; i += 1) stepFighter(self, opponent, EMPTY_INPUT, i, true, 0, []);
    stepFighter(self, opponent, BUTTON.Right, 5, true, 0, []);
    expect(self.vx).toBeCloseTo(full, 10);
  });

  it('takes the longer of two overlapping slows rather than the newer', () => {
    const self = { ...createFighter('ok', 500, 1), slowTicks: 90 };
    const d = self;
    resolveHit(createFighter('sauce', 400, 1), d, getSpec('sauce-sticky'), 0, 0, []);
    expect(d.slowTicks).toBe(90);
  });
});

describe('an installed fighter’s state is part of the world', () => {
  it('survives a snapshot, so a rollback cannot lose or invent a buff', () => {
    const w = toFight(world({ p1Character: 'goblin' }));
    w.fighters[0].installTicks = 123;
    w.fighters[1].slowTicks = 45;
    const clone = structuredClone(w);
    expect(clone.fighters[0].installTicks).toBe(123);
    expect(clone.fighters[1].slowTicks).toBe(45);
  });

  it('is reflected in the checksum', () => {
    // Two worlds identical but for a buff must not agree, or the desync that a
    // mismatched status causes would go unreported.
    const a = toFight(world());
    const b = toFight(world());
    expect(checksum(a)).toBe(checksum(b));

    a.fighters[0].installTicks = 10;
    expect(checksum(a)).not.toBe(checksum(b));

    a.fighters[0].installTicks = 0;
    a.fighters[1].slowTicks = 7;
    expect(checksum(a)).not.toBe(checksum(b));
  });
});

describe('meter and state guards', () => {
  it('keeps the ultimate’s install even when the swing misses', () => {
    const w = toFight(world({ p1Character: 'doge' }));
    w.fighters[0].energy = MAX_ENERGY;
    w.fighters[1].x = 1100; // far out of reach
    run(w, 1, BUTTON.Down | BUTTON.Special);
    while (w.hitStopTicks > 0) run(w, 1);
    run(w, 120);
    expect(w.fighters[1].hp).toBe(MAX_HP);
    expect(w.fighters[0].installTicks).toBeGreaterThan(0);
    expect(w.fighters[0].state).not.toBe(FighterState.ULTIMATE);
  });
});
