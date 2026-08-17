import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import {
  ARENA_MAX_X,
  ARENA_MIN_X,
  DT,
  GRAVITY,
  GROUND_Y,
  JUMP_VELOCITY,
  STUN_FRICTION_PER_TICK,
} from '../constants';
import { createFighter, isAirborne, stepPhysics } from '../fighter';
import type { SimFighter } from '../types';
import { attackRuntime } from './factories';

/**
 * Physics is ported from Fighter.applyPhysics — see docs/sim-spec.md §4. The
 * integration order (gravity, then y, then x) and the `vy < 0` lift-off term are
 * load-bearing; assert the shape of the motion, not just the endpoints.
 */

const spawn = (overrides: Partial<SimFighter> = {}): SimFighter => ({
  ...createFighter('pink', 350, 1),
  ...overrides,
});

/** Advance `ticks` steps and return the fighter, for readability in assertions. */
const advance = (fighter: SimFighter, ticks: number): SimFighter => {
  for (let i = 0; i < ticks; i += 1) stepPhysics(fighter);
  return fighter;
};

describe('isAirborne', () => {
  it('treats a fighter on the ground plane as grounded', () => {
    expect(isAirborne(spawn({ y: GROUND_Y }))).toBe(false);
  });

  it('allows a one-pixel tolerance below the ground plane', () => {
    // Ported verbatim: `y < GROUND_Y - 1`. Landing leaves tiny residuals, and
    // without the tolerance a fighter can flicker between grounded and airborne.
    expect(isAirborne(spawn({ y: GROUND_Y - 0.5 }))).toBe(false);
    expect(isAirborne(spawn({ y: GROUND_Y - 1 }))).toBe(false);
    expect(isAirborne(spawn({ y: GROUND_Y - 1.01 }))).toBe(true);
  });
});

describe('gravity and jumping', () => {
  it('lifts off on the first tick even though the fighter is still grounded', () => {
    // The `vy < 0` term is what makes this work: on the tick a jump starts, `y`
    // has not moved yet, so `isAirborne` is still false.
    const fighter = spawn({ vy: JUMP_VELOCITY, state: FighterState.JUMP });
    expect(isAirborne(fighter)).toBe(false);

    stepPhysics(fighter);

    expect(fighter.y).toBeLessThan(GROUND_Y);
    expect(isAirborne(fighter)).toBe(true);
  });

  it('accelerates downwards at GRAVITY while airborne', () => {
    const fighter = spawn({ y: GROUND_Y - 200, vy: 0 });
    stepPhysics(fighter);
    expect(fighter.vy).toBeCloseTo(GRAVITY * DT, 10);
  });

  it('rises then falls, reaching an apex above the ground', () => {
    const fighter = spawn({ vy: JUMP_VELOCITY, state: FighterState.JUMP });
    let apex = GROUND_Y;
    for (let i = 0; i < 60; i += 1) {
      stepPhysics(fighter);
      apex = Math.min(apex, fighter.y);
    }
    // v^2 / 2g = 690^2 / 3500 ~= 136 px above the ground.
    expect(GROUND_Y - apex).toBeGreaterThan(120);
    expect(GROUND_Y - apex).toBeLessThan(150);
  });

  it('lands back on the ground plane with zero vertical velocity', () => {
    const fighter = spawn({ vy: JUMP_VELOCITY, state: FighterState.JUMP });
    advance(fighter, 60);
    expect(fighter.y).toBe(GROUND_Y);
    expect(fighter.vy).toBe(0);
  });

  it('completes a jump in roughly 48 ticks', () => {
    const fighter = spawn({ vy: JUMP_VELOCITY, state: FighterState.JUMP });
    let ticks = 0;
    while (ticks < 200 && (ticks === 0 || isAirborne(fighter))) {
      stepPhysics(fighter);
      ticks += 1;
    }
    // 2 * 690 / 1750 = 0.789 s = 47.3 ticks.
    expect(ticks).toBeGreaterThanOrEqual(46);
    expect(ticks).toBeLessThanOrEqual(50);
  });

  it('returns a jumping fighter to IDLE on landing', () => {
    const fighter = spawn({ vy: JUMP_VELOCITY, state: FighterState.JUMP });
    advance(fighter, 60);
    expect(fighter.state).toBe(FighterState.IDLE);
  });

  it('does not overwrite a non-jump state on landing', () => {
    // A fighter knocked into the air stays in HITSTUN when it touches down; only
    // the JUMP state is converted.
    const fighter = spawn({ y: GROUND_Y - 4, vy: 300, state: FighterState.HITSTUN });
    advance(fighter, 3);
    expect(fighter.y).toBe(GROUND_Y);
    expect(fighter.state).toBe(FighterState.HITSTUN);
  });
});

describe('horizontal motion', () => {
  it('advances a grounded fighter by vx each tick', () => {
    const fighter = spawn({ vx: 280 });
    stepPhysics(fighter);
    expect(fighter.x).toBeCloseTo(350 + 280 * DT, 10);
  });

  it('advances an airborne fighter by vx as well', () => {
    const fighter = spawn({ y: GROUND_Y - 100, vx: -280 });
    stepPhysics(fighter);
    expect(fighter.x).toBeCloseTo(350 - 280 * DT, 10);
  });

  it('suppresses vx for a grounded dash or slide attack', () => {
    // Dash and slide drive themselves through attack motion; applying vx as well
    // would double their speed.
    for (const kind of ['dash', 'slide'] as const) {
      const fighter = spawn({
        vx: 280,
        attack: attackRuntime({ specId: 'x', kind }),
      });
      stepPhysics(fighter);
      expect(fighter.x, kind).toBe(350);
    }
  });

  it('still applies vx for a grounded non-dash attack', () => {
    const fighter = spawn({
      vx: 280,
      attack: attackRuntime({ specId: 'x', kind: 'melee' }),
    });
    stepPhysics(fighter);
    expect(fighter.x).toBeCloseTo(350 + 280 * DT, 10);
  });
});

describe('arena clamping', () => {
  it('stops a fighter at the left wall', () => {
    const fighter = spawn({ x: ARENA_MIN_X + 1, vx: -2000 });
    advance(fighter, 5);
    expect(fighter.x).toBe(ARENA_MIN_X);
  });

  it('stops a fighter at the right wall', () => {
    const fighter = spawn({ x: ARENA_MAX_X - 1, vx: 2000 });
    advance(fighter, 5);
    expect(fighter.x).toBe(ARENA_MAX_X);
  });

  it('clamps an airborne fighter too', () => {
    const fighter = spawn({ x: ARENA_MAX_X - 1, y: GROUND_Y - 120, vx: 4000 });
    stepPhysics(fighter);
    expect(fighter.x).toBe(ARENA_MAX_X);
  });
});

describe('stun friction', () => {
  it.each([FighterState.HITSTUN, FighterState.BLOCKSTUN, FighterState.KO])(
    'decays vx while in %s',
    (state) => {
      const fighter = spawn({ vx: 400, state });
      stepPhysics(fighter);
      expect(fighter.vx).toBeCloseTo(400 * STUN_FRICTION_PER_TICK, 10);
    },
  );

  it('leaves vx alone in every other state', () => {
    for (const state of [FighterState.IDLE, FighterState.WALK, FighterState.JUMP, FighterState.BLOCK]) {
      const fighter = spawn({ vx: 400, state, y: GROUND_Y });
      stepPhysics(fighter);
      expect(fighter.vx, state).toBe(400);
    }
  });

  it('bleeds knockback down to a few percent within half a second', () => {
    const initial = 520; // the heaviest knockbackX in the roster
    const fighter = spawn({ vx: initial, state: FighterState.HITSTUN });
    advance(fighter, 30);
    expect(Math.abs(fighter.vx) / initial).toBeLessThan(0.05);
  });

  it('never reverses the direction of the knockback', () => {
    const fighter = spawn({ vx: -520, state: FighterState.HITSTUN });
    for (let i = 0; i < 40; i += 1) {
      stepPhysics(fighter);
      expect(fighter.vx).toBeLessThanOrEqual(0);
    }
  });
});

describe('determinism', () => {
  it('produces bit-identical results for identical starting states', () => {
    const run = () => {
      const fighter = spawn({ vx: 313, vy: JUMP_VELOCITY, state: FighterState.JUMP });
      const trace: number[] = [];
      for (let i = 0; i < 120; i += 1) {
        stepPhysics(fighter);
        trace.push(fighter.x, fighter.y, fighter.vx, fighter.vy);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });

  it('never produces NaN or Infinity', () => {
    const fighter = spawn({ vx: 1e6, vy: -1e6, state: FighterState.HITSTUN });
    for (let i = 0; i < 500; i += 1) {
      stepPhysics(fighter);
      for (const value of [fighter.x, fighter.y, fighter.vx, fighter.vy]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
