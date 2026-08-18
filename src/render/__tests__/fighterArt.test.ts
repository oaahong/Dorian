import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import { CHARGE_LEVEL_2_TICKS, CHARGE_LEVEL_3_TICKS } from '../../fighters/chargeSpecials';
import { POSE_NAMES, chargeTextureKey, poseTextureKey, releaseTextureKey, skillTexturesFor } from '../../fighters/poseSheet';
import { ultimateVisualsFor } from '../../fighters/ultimateVisuals';
import { INSTALL_ATTACHMENTS, INSTALL_POSES } from '../../fighters/installPoses';
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
    //
    // The set is built from the same functions `PrepareMatchScene` loads from,
    // not from a list restated here: a restated list agrees with the loader only
    // until one of them changes.
    const loadable = new Set<string>();
    for (const config of FIGHTERS) {
      for (const pose of POSE_NAMES) loadable.add(poseTextureKey(config.id, pose));
      for (const { key } of skillTexturesFor(config.id)) loadable.add(key);
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

describe('the meme moves and dashes', () => {
  /**
   * Five states that were added with the combo layer, each of which has to reach
   * a frame that the match actually loads. A missing texture draws as a box
   * rather than throwing, so nothing but an assertion catches it.
   */
  const cases: [FighterState, string][] = [
    [FighterState.MEME_IMPACT, 'heavy'],
    [FighterState.MEME_PARRY, 'block'],
    [FighterState.MEME_RUSH, 'dashForward'],
    [FighterState.DASH_FORWARD, 'dashForward'],
    [FighterState.DASH_BACK, 'dashBack'],
  ];

  it.each(cases)('draws %s as %s', (state, expected) => {
    expect(poseFor(fighter({ state }))).toBe(expected);
  });

  it('resolves each to a texture the match loads, for every fighter', () => {
    for (const config of FIGHTERS) {
      for (const [state] of cases) {
        const key = artFor({ ...fighter({ state }), configId: config.id }).key;
        const loaded = POSE_NAMES.map((pose) => poseTextureKey(config.id, pose));
        expect(loaded, `${config.id} ${state}`).toContain(key);
      }
    }
  });

  /** A dash is movement; drawing it as a walk would hide that it is committed. */
  it('tells the two dashes apart', () => {
    expect(poseFor(fighter({ state: FighterState.DASH_FORWARD }))).not.toBe(
      poseFor(fighter({ state: FighterState.DASH_BACK })),
    );
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

describe('the ultimate', () => {
  it('draws the fighter from its own skill sheet, not the generic pose', () => {
    // The numbered pose sheet has one `ultimate` frame per fighter, which is a
    // single drawing for a move that runs for two seconds and has a script. Each
    // ultimate names the cell its owner holds while it plays.
    for (const config of FIGHTERS) {
      const art = artFor(fighter({ configId: config.id, state: FighterState.ULTIMATE }));
      expect(art.key, config.id).toBe(
        `skill-${config.id}-${ultimateVisualsFor(config.id).ownerCell.toLowerCase()}`,
      );
    }
  });

  it('sizes it as an ultimate, so it reads larger than a normal', () => {
    expect(artFor(fighter({ state: FighterState.ULTIMATE })).size).toBe('ultimate');
  });

  it('resolves to a texture the match loads, for every fighter', () => {
    for (const config of FIGHTERS) {
      const art = artFor(fighter({ configId: config.id, state: FighterState.ULTIMATE }));
      expect(skillTexturesFor(config.id).map((t) => t.key), config.id).toContain(art.key);
    }
  });

  it('goes back to an ordinary pose once the state is over', () => {
    // tempura and scared release on tick 20 and keep fighting while their
    // companions are still on the field; an override that outlived the state
    // would freeze them mid-shout.
    const art = artFor(fighter({ configId: 'tempura', state: FighterState.IDLE }));
    expect(art.key).toBe(poseTextureKey('tempura', 'idle'));
  });
});

describe('a transformed fighter', () => {
  const installed = (configId: string, state: FighterState): SimFighter =>
    fighter({ configId, state, installTicks: 300 });

  const INSTALLERS = ['doge', 'goblin', 'blade', 'pink'] as const;

  it('draws from the transformed set, not the ordinary sheet', () => {
    for (const configId of INSTALLERS) {
      const art = artFor(installed(configId, FighterState.IDLE));
      expect(art.key, configId).toBe(`skill-${configId}-${INSTALL_POSES[configId]!.idle!.toLowerCase()}`);
    }
  });

  it('resolves every state to a texture the match loads', () => {
    // The failure this catches is a cell named in the table that the sheet does
    // not have — which renders as a green box on whichever pose was mistyped.
    for (const configId of INSTALLERS) {
      const loadable = new Set(skillTexturesFor(configId).map((t) => t.key));
      for (const pose of POSE_NAMES) loadable.add(poseTextureKey(configId, pose));

      for (const state of Object.values(FighterState)) {
        const art = artFor(installed(configId, state));
        expect(loadable.has(art.key), `${configId} in ${state} -> ${art.key}`).toBe(true);
      }
    }
  });

  it('falls back to the ordinary sheet for a pose it was never drawn in', () => {
    // doge has no transformed guard drawing. Falling through has to reach a real
    // texture rather than a key nobody loaded.
    expect(INSTALL_POSES.doge!.block).toBeUndefined();
    expect(artFor(installed('doge', FighterState.BLOCK)).key).toBe(poseTextureKey('doge', 'block'));
  });

  it('goes back to the ordinary sheet the tick the install ends', () => {
    const after = artFor(fighter({ configId: 'doge', state: FighterState.IDLE, installTicks: 0 }));
    expect(after.key).toBe(poseTextureKey('doge', 'idle'));
  });

  it('leaves fighters without a transformation alone', () => {
    // Only four ultimates transform. An install status on anybody else — there is
    // no way to get one today, but the table is a lookup, not a guarantee — must
    // not send them to a sheet that has no transformed poses on it.
    expect(artFor(installed('alien', FighterState.IDLE)).key).toBe(poseTextureKey('alien', 'idle'));
  });

  describe('the upgraded build put an effect layer where the idle pose goes', () => {
    // Pinned individually, because each is a different cell and each would look
    // like a plausible port if it came back.
    it('does not idle doge as an exploding silhouette', () => {
      expect(artFor(installed('doge', FighterState.IDLE)).key).not.toBe('skill-doge-i');
    });

    it('does not idle goblin as a dissolving clock', () => {
      expect(artFor(installed('goblin', FighterState.IDLE)).key).not.toBe('skill-goblin-j');
    });

    it('does not idle pink as a magenta burst', () => {
      expect(artFor(installed('pink', FighterState.IDLE)).key).not.toBe('skill-pink-k');
    });
  });
});

describe("blade's swords", () => {
  it('mounts exactly the two the pipeline split out, and never the cell they came from', () => {
    // `blade/K` is both swords in one image. It is the source the two modules were
    // derived from, so drawing it as well would put a third sword on screen — the
    // delivered notes call that out by name.
    expect(INSTALL_ATTACHMENTS.blade).toEqual(['K_weapon_blue', 'K_weapon_black']);

    const drawn = new Set([
      ...Object.values(INSTALL_POSES.blade!),
      ...ultimateVisualsFor('blade').beats.map((b) => b.cell),
      ultimateVisualsFor('blade').ownerCell,
    ]);
    expect(drawn.has('K')).toBe(false);
  });

  it('names textures the match loads', () => {
    const loadable = new Set(skillTexturesFor('blade').map((t) => t.key));
    for (const cell of INSTALL_ATTACHMENTS.blade!) {
      expect(loadable).toContain(`skill-blade-${cell.toLowerCase()}`);
    }
  });

  it('gives nobody else an attachment', () => {
    expect(Object.keys(INSTALL_ATTACHMENTS)).toEqual(['blade']);
  });
});

describe('the overlap between an ultimate and the install it grants', () => {
  it('shows the transformed body from the peak, not from when control returns', () => {
    /**
     * doge installs on timeline tick 54 and keeps the `ULTIMATE` state until tick
     * 64. For those ten ticks the fighter is transformed *and* still mid-ultimate,
     * and the transformation is what the player has to be able to see — the beat
     * announcing it has already played.
     */
    const midPeak = fighter({
      configId: 'doge',
      state: FighterState.ULTIMATE,
      installTicks: 480,
    });
    expect(artFor(midPeak).key).toBe(`skill-doge-${INSTALL_POSES.doge!.idle!.toLowerCase()}`);
  });

  it('still shows the casting frame before the install lands', () => {
    const preTransform = fighter({ configId: 'doge', state: FighterState.ULTIMATE, installTicks: 0 });
    expect(artFor(preTransform).key).toBe(
      `skill-doge-${ultimateVisualsFor('doge').ownerCell.toLowerCase()}`,
    );
  });
});
