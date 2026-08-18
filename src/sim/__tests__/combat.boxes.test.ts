import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import {
  CROUCH_HURTBOX_SCALE,
  FIGHTER_HURTBOX_HEIGHT,
  FIGHTER_HURTBOX_WIDTH,
  GROUND_Y,
  INSTALL_BODY_SCALE,
} from '../constants';
import { HEAVY_SPEC, LIGHT_SPEC } from '../attackSpecs';
import { createFighter } from '../fighter';
import { getHurtbox, getMeleeHitbox, rectsIntersect } from '../combat';
import type { SimFighter } from '../types';
import { attackRuntime } from './factories';

/** Box geometry, ported from Fighter.getHurtbox / getMeleeHitbox. See docs/gameplay/sim-spec.md §6. */

const at = (x: number, overrides: Partial<SimFighter> = {}): SimFighter => ({
  ...createFighter('pink', x, 1),
  ...overrides,
});

const attacking = (x: number, facing: 1 | -1, crouching = false, airborne = false): SimFighter =>
  at(x, {
    facing,
    state: FighterState.LIGHT_ATTACK,
    attack: attackRuntime({ elapsedTicks: LIGHT_SPEC.startupTicks, crouching, airborne }),
  });

describe('rectsIntersect', () => {
  const base = { x: 0, y: 0, width: 10, height: 10 };

  it('detects overlap', () => {
    expect(rectsIntersect(base, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
  });

  it('rejects separation on either axis', () => {
    expect(rectsIntersect(base, { x: 20, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsIntersect(base, { x: 0, y: 20, width: 10, height: 10 })).toBe(false);
  });

  it('treats touching edges as no contact', () => {
    expect(rectsIntersect(base, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('detects full containment', () => {
    expect(rectsIntersect(base, { x: 2, y: 2, width: 2, height: 2 })).toBe(true);
  });
});

describe('getHurtbox', () => {
  it('centres a standing box on the fighter, rising from its feet', () => {
    const box = getHurtbox(at(500));
    expect(box.width).toBe(FIGHTER_HURTBOX_WIDTH);
    expect(box.height).toBe(FIGHTER_HURTBOX_HEIGHT);
    expect(box.x).toBe(500 - FIGHTER_HURTBOX_WIDTH / 2);
    expect(box.y).toBe(GROUND_Y - FIGHTER_HURTBOX_HEIGHT);
  });

  it('shortens the box while crouching, keeping the feet planted', () => {
    const box = getHurtbox(at(500, { state: FighterState.CROUCH }));
    expect(box.height).toBeCloseTo(FIGHTER_HURTBOX_HEIGHT * 0.66, 10);
    expect(box.y + box.height).toBe(GROUND_Y);
  });

  it('shortens the box for a crouching attack too', () => {
    const box = getHurtbox(attacking(500, 1, true));
    expect(box.height).toBeCloseTo(FIGHTER_HURTBOX_HEIGHT * 0.66, 10);
  });

  it('keeps the full height for a standing attack', () => {
    expect(getHurtbox(attacking(500, 1)).height).toBe(FIGHTER_HURTBOX_HEIGHT);
  });

  it('follows the fighter into the air', () => {
    const box = getHurtbox(at(500, { y: GROUND_Y - 130 }));
    expect(box.y + box.height).toBe(GROUND_Y - 130);
  });
});

describe('getMeleeHitbox', () => {
  it('extends in front of a right-facing fighter', () => {
    const box = getMeleeHitbox(attacking(500, 1), LIGHT_SPEC);
    expect(box.x).toBe(500 + 34);
    expect(box.width).toBeGreaterThan(0);
  });

  it('mirrors for a left-facing fighter', () => {
    const right = getMeleeHitbox(attacking(500, 1), LIGHT_SPEC);
    const left = getMeleeHitbox(attacking(500, -1), LIGHT_SPEC);
    expect(left.width).toBe(right.width);
    expect(left.x + left.width).toBe(500 - 34);
  });

  it('scales reach by the range stat', () => {
    // 'goblin' has rangeStat 2 -> 0.99x, 'alien' has 5 -> 1.155x.
    const short = getMeleeHitbox(
      { ...attacking(500, 1), configId: 'goblin' },
      LIGHT_SPEC,
    );
    const long = getMeleeHitbox(
      { ...attacking(500, 1), configId: 'alien' },
      LIGHT_SPEC,
    );
    expect(long.width).toBeGreaterThan(short.width);
    expect(short.width).toBeCloseTo(LIGHT_SPEC.reach * (0.88 + 2 * 0.055), 10);
    expect(long.width).toBeCloseTo(LIGHT_SPEC.reach * (0.88 + 5 * 0.055), 10);
  });

  it('gives heavy a longer box than light', () => {
    const light = getMeleeHitbox(attacking(500, 1), LIGHT_SPEC);
    const heavy = getMeleeHitbox(attacking(500, 1), HEAVY_SPEC);
    expect(heavy.width).toBeGreaterThan(light.width);
  });

  it('drops the box low and shrinks it for a crouching attack', () => {
    const standing = getMeleeHitbox(attacking(500, 1), LIGHT_SPEC);
    const crouched = getMeleeHitbox(attacking(500, 1, true), LIGHT_SPEC);
    expect(crouched.height).toBe(70);
    expect(standing.height).toBe(100);
    // Lower on screen means a larger y.
    expect(crouched.y).toBeGreaterThan(standing.y);
  });

  it('sits slightly lower for an air attack than a standing one', () => {
    const standing = getMeleeHitbox(attacking(500, 1), LIGHT_SPEC);
    const air = getMeleeHitbox(attacking(500, 1, false, true), LIGHT_SPEC);
    expect(air.y).toBeGreaterThan(standing.y);
    expect(air.height).toBe(100);
  });
});

describe('reach in practice', () => {
  it('connects with an opponent standing just in front', () => {
    const attacker = attacking(500, 1);
    const defender = at(560);
    expect(rectsIntersect(getMeleeHitbox(attacker, LIGHT_SPEC), getHurtbox(defender))).toBe(true);
  });

  it('whiffs against an opponent out of range', () => {
    const attacker = attacking(500, 1);
    const defender = at(760);
    expect(rectsIntersect(getMeleeHitbox(attacker, LIGHT_SPEC), getHurtbox(defender))).toBe(false);
  });

  it('whiffs against an opponent behind the attacker', () => {
    const attacker = attacking(500, 1);
    const defender = at(420);
    expect(rectsIntersect(getMeleeHitbox(attacker, LIGHT_SPEC), getHurtbox(defender))).toBe(false);
  });

  it('does not let a crouching defender duck a standing light attack', () => {
    /**
     * Characterizing the geometry as it is, not as a fighting game would usually
     * have it: the standing melee box is centred 108 px up with a height of 100,
     * so it spans roughly 58..158 above the feet, while a crouched hurtbox still
     * reaches 128. They overlap, so crouching is not an evasion in this game — it
     * only shrinks the target.
     */
    const attacker = attacking(500, 1);
    const standing = at(560);
    const crouched = at(560, { state: FighterState.CROUCH });
    expect(rectsIntersect(getMeleeHitbox(attacker, LIGHT_SPEC), getHurtbox(standing))).toBe(true);
    expect(rectsIntersect(getMeleeHitbox(attacker, LIGHT_SPEC), getHurtbox(crouched))).toBe(true);
  });

  it('lets a jumping defender clear a standing attack', () => {
    const attacker = attacking(500, 1);
    const airborne = at(560, { y: GROUND_Y - 170 });
    expect(rectsIntersect(getMeleeHitbox(attacker, LIGHT_SPEC), getHurtbox(airborne))).toBe(false);
  });
});

describe('a transformed fighter is a bigger target', () => {
  /**
   * The four install ultimates make their owner physically larger, and the
   * upgraded build's delivered notes are explicit that the hurtbox follows the
   * body rather than staying at the untransformed size. That is the cost of the
   * transformation: hitting harder while being easier to hit.
   *
   * It is the one part of this work that reaches into the simulation, so it is
   * pinned by behaviour and not only by arithmetic.
   */
  it('doubles the standing box while the install runs', () => {
    const normal = getHurtbox(at(400));
    const installed = getHurtbox(at(400, { installTicks: 300 }));

    expect(installed.width).toBe(normal.width * INSTALL_BODY_SCALE);
    expect(installed.height).toBe(normal.height * INSTALL_BODY_SCALE);
  });

  it('keeps the feet on the floor, growing upward and outward from centre', () => {
    const installed = getHurtbox(at(400, { installTicks: 300, y: GROUND_Y }));

    expect(installed.y + installed.height).toBe(GROUND_Y);
    expect(installed.x + installed.width / 2).toBe(400);
  });

  it('scales the crouching box too, so ducking still lowers the head', () => {
    const standing = getHurtbox(at(400, { installTicks: 300 }));
    const crouching = getHurtbox(at(400, { installTicks: 300, state: FighterState.CROUCH }));

    expect(crouching.height).toBeLessThan(standing.height);
    expect(crouching.height).toBe(FIGHTER_HURTBOX_HEIGHT * CROUCH_HURTBOX_SCALE * INSTALL_BODY_SCALE);
  });

  it('goes back to normal the tick the install ends', () => {
    expect(getHurtbox(at(400, { installTicks: 0 }))).toEqual(getHurtbox(at(400)));
  });

  it('lets an attack reach a transformed fighter that would have whiffed', () => {
    // The behaviour, not the number: a light that falls short of the normal box
    // connects with the transformed one, because the transformed one is wider.
    const attacker = attacking(400, 1);
    const box = getMeleeHitbox(attacker, LIGHT_SPEC);
    const justOutOfRange = box.x + box.width + FIGHTER_HURTBOX_WIDTH / 2 + 4;

    const normal = at(justOutOfRange);
    const installed = at(justOutOfRange, { installTicks: 300 });

    expect(rectsIntersect(box, getHurtbox(normal))).toBe(false);
    expect(rectsIntersect(box, getHurtbox(installed))).toBe(true);
  });
});
