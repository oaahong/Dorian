import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import { CHARGE_LEVEL_2_TICKS, CHARGE_LEVEL_3_TICKS } from '../../fighters/chargeSpecials';
import { POSE_NAMES, chargeTextureKey, poseTextureKey, releaseTextureKey } from '../../fighters/poseSheet';
import { FIGHTERS } from '../../fighters/fighterData';
import { createFighter } from '../../sim/fighter';
import { artFor, poseFor } from '../FighterView';
import { attackRuntime } from '../../sim/__tests__/factories';
import type { SimFighter } from '../../sim/types';

/**
 * Which frame the view draws, derived from simulation state.
 *
 * Testable without a browser because it is a pure function — the whole reason the
 * view holds no state of its own about what a fighter looks like.
 */

const fighter = (overrides: Partial<SimFighter> = {}): SimFighter => ({
  ...createFighter('scared', 400, 1),
  ...overrides,
});

describe('artFor', () => {
  it('shows the wind-up frame for the level actually reached', () => {
    // The only way a player can tell a level 2 from a level 3 before letting go.
    const levels: [number, 1 | 2 | 3][] = [
      [0, 1],
      [CHARGE_LEVEL_2_TICKS - 1, 1],
      [CHARGE_LEVEL_2_TICKS, 2],
      [CHARGE_LEVEL_3_TICKS - 1, 2],
      [CHARGE_LEVEL_3_TICKS, 3],
    ];
    for (const [ticks, level] of levels) {
      const art = artFor(fighter({ state: FighterState.H_CHARGING, chargeTicks: ticks }));
      expect(art.key, `${ticks} ticks`).toBe(chargeTextureKey('scared', level));
    }
  });

  it('gives each charge level a distinct frame', () => {
    const keys = ([1, 2, 3] as const).map((level) => chargeTextureKey('scared', level));
    expect(new Set(keys).size).toBe(3);
  });

  it('shows the release frame while the charge is coming out', () => {
    const art = artFor(
      fighter({ state: FighterState.SPECIAL, attack: attackRuntime({ specId: 'h-scared-2' }) }),
    );
    expect(art.key).toBe(releaseTextureKey('scared'));
  });

  it('leaves an ordinary special on the numbered pose sheet', () => {
    // Only the chargeable special is drawn from the skill sheet.
    const art = artFor(
      fighter({ state: FighterState.SPECIAL, attack: attackRuntime({ specId: 'scared-scream' }) }),
    );
    expect(art.key).toBe(poseTextureKey('scared', 'special'));
  });

  it('sizes an ultimate larger than a fighter, and a downed one between', () => {
    const ultimate = artFor(fighter({ state: FighterState.ULTIMATE }));
    const downed = artFor(fighter({ state: FighterState.KO }));
    const standing = artFor(fighter({ state: FighterState.IDLE }));
    expect(ultimate.size).toBe('ultimate');
    expect(downed.size).toBe('downed');
    expect(standing.size).toBe('fighter');
  });

  it('resolves to a texture the match actually loads, for every fighter and state', () => {
    // A key nothing loaded renders as a green box, which is the failure this
    // catches — the pose sheet and the skill sheet are loaded from two places.
    const loadable = new Set<string>();
    for (const config of FIGHTERS) {
      for (const pose of POSE_NAMES) loadable.add(poseTextureKey(config.id, pose));
      for (const level of [1, 2, 3] as const) loadable.add(chargeTextureKey(config.id, level));
      loadable.add(releaseTextureKey(config.id));
    }

    for (const config of FIGHTERS) {
      const states = Object.values(FighterState);
      for (const state of states) {
        const art = artFor({ ...createFighter(config.id, 400, 1), state });
        expect(loadable.has(art.key), `${config.id} in ${state} -> ${art.key}`).toBe(true);
      }
    }
  });
});

describe('the six normals', () => {
  /**
   * Six moves that all leave the fighter in LIGHT_ATTACK or HEAVY_ATTACK, so the
   * state alone cannot tell them apart — the stance frozen on the attack is what
   * separates them, and drawing the standing swing for all six would hide the low
   * the opponent is supposed to be reading.
   */
  const cases: [FighterState, { crouching?: boolean; airborne?: boolean }, string][] = [
    [FighterState.LIGHT_ATTACK, {}, 'light'],
    [FighterState.HEAVY_ATTACK, {}, 'heavy'],
    [FighterState.LIGHT_ATTACK, { crouching: true }, 'crouchLight'],
    [FighterState.HEAVY_ATTACK, { crouching: true }, 'crouchHeavy'],
    [FighterState.LIGHT_ATTACK, { airborne: true }, 'jumpLight'],
    [FighterState.HEAVY_ATTACK, { airborne: true }, 'jumpHeavy'],
  ];

  it.each(cases)('draws %s %o as %s', (state, stance, expected) => {
    const f = fighter({ state, attack: attackRuntime({ specId: 'light', ...stance }) });
    expect(poseFor(f)).toBe(expected);
  });

  it('gives all six a distinct frame', () => {
    const poses = cases.map(([state, stance]) =>
      poseFor(fighter({ state, attack: attackRuntime({ specId: 'light', ...stance }) })),
    );
    expect(new Set(poses).size).toBe(6);
  });
});

describe('poseFor', () => {
  it('tells a forward walk from a backward one by which way it is moving', () => {
    expect(poseFor(fighter({ state: FighterState.WALK, vx: 100, facing: 1 }))).toBe('walkForward');
    expect(poseFor(fighter({ state: FighterState.WALK, vx: -100, facing: 1 }))).toBe('walkBack');
  });

  it('falls back to idle for a state with no frame of its own', () => {
    // `artFor` intercepts H_CHARGING before this is asked, so the pose sheet has no
    // entry for it and should not grow one.
    expect(poseFor(fighter({ state: FighterState.H_CHARGING }))).toBe('idle');
  });
});
