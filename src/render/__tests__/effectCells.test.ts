import { describe, it, expect } from 'vitest';
import { FIGHTERS } from '../../fighters/fighterData';
import { chargeSpecialFor } from '../../fighters/chargeSpecials';
import { skillTexturesFor } from '../../fighters/poseSheet';
import { SKILL_CELLS } from '../../fighters/skillCells';
import { effectCellFor, effectTextureFor, needsReleaseFlash } from '../effectCells';

/**
 * The art a charge special is made of.
 *
 * Every fighter's sheet carries three of these — the pipeline files them as
 * `H_OR_SHARED_VFX` — and they are the same move at its three strengths: alien's
 * beam thickens, blade's sword lengthens, scared's portal widens. None of them
 * had ever been drawn; the charge special rendered as a coloured rectangle at
 * every level, which is a lot of frame data the player cannot see.
 */

const LEVELS = [1, 2, 3] as const;

describe('effectCellFor', () => {
  it('gives every fighter three distinct cells, one per charge level', () => {
    for (const fighter of FIGHTERS) {
      const cells = LEVELS.map((level) => effectCellFor(fighter.id, level));
      expect(new Set(cells).size, `${fighter.id}: ${cells.join()}`).toBe(3);
    }
  });

  it('names a cell the fighter actually has', () => {
    for (const fighter of FIGHTERS) {
      for (const level of LEVELS) {
        expect(SKILL_CELLS[fighter.id], fighter.id).toContain(effectCellFor(fighter.id, level));
      }
    }
  });

  it('rises with the level, so a longer hold looks like one', () => {
    // The cells are ordered on the sheet, so the ordering is the guarantee that
    // level 3 does not draw the smallest of the three.
    expect(LEVELS.map((level) => effectCellFor('alien', level))).toEqual(['E', 'F', 'G']);
  });
});

describe('effectTextureFor', () => {
  it('resolves a charge spec id to a texture the match loads', () => {
    for (const fighter of FIGHTERS) {
      const loadable = new Set(skillTexturesFor(fighter.id).map((t) => t.key));
      for (const spec of chargeSpecialFor(fighter.id).levels) {
        const key = effectTextureFor(spec.id);
        expect(key, `${fighter.id} ${spec.id}`).not.toBeNull();
        expect(loadable, `${fighter.id} ${spec.id}`).toContain(key!);
      }
    }
  });

  it('picks the texture matching the level that was actually held', () => {
    const levels = chargeSpecialFor('blade').levels;
    expect(levels.map((spec) => effectTextureFor(spec.id))).toEqual([
      'skill-blade-e',
      'skill-blade-f',
      'skill-blade-g',
    ]);
  });

  it('returns null for anything that is not a charge special', () => {
    // Motion specials and normals keep the shapes they already draw. Inventing a
    // mapping for them would put a fighter's charge art on a move it is not.
    expect(effectTextureFor('light')).toBeNull();
    expect(effectTextureFor(FIGHTERS[0]!.specials.quarterForward.id)).toBeNull();
    expect(effectTextureFor('nonsense')).toBeNull();
  });
});

describe('where the effect gets drawn', () => {
  it('leaves it to the entity for a move that spawns one', () => {
    // alien's beam, sauce's projectile and ya's zone all put something into the
    // world that the art travels with. Drawing a second copy at the fighter would
    // be the same picture twice.
    for (const fighterId of ['alien', 'sauce', 'ya', 'wizard']) {
      for (const spec of chargeSpecialFor(fighterId).levels) {
        expect(needsReleaseFlash(spec.id), `${fighterId} ${spec.id}`).toBe(false);
      }
    }
  });

  it('draws it at the fighter for a move that spawns nothing', () => {
    // doge's charge, goblin's grab, blade's slash and salad's shockwave are all
    // melee: no entity, so without this their three cells are never drawn at all.
    for (const fighterId of ['doge', 'goblin', 'blade', 'salad', 'scared', 'tempura']) {
      for (const spec of chargeSpecialFor(fighterId).levels) {
        expect(needsReleaseFlash(spec.id), `${fighterId} ${spec.id}`).toBe(true);
      }
    }
  });

  it('says no for anything that is not a charge special', () => {
    expect(needsReleaseFlash('light')).toBe(false);
  });

  it('accounts for every fighter one way or the other', () => {
    // The property that matters for asset coverage: each fighter's three cells
    // reach the screen by exactly one of the two routes.
    for (const fighter of FIGHTERS) {
      const spec = chargeSpecialFor(fighter.id).levels[0]!;
      const entity = ['beam', 'projectile', 'zone'].includes(spec.kind);
      expect(needsReleaseFlash(spec.id), fighter.id).toBe(!entity);
    }
  });
});
