import { describe, it, expect } from 'vitest';
import { FIGHTERS } from '../../fighters/fighterData';
import { SKILL_CELLS } from '../../fighters/skillCells';
import { INSTALL_ATTACHMENTS, INSTALL_POSES } from '../../fighters/installPoses';
import { ultimateVisualsFor } from '../../fighters/ultimateVisuals';
import { ultimateDefinitionFor } from '../../fighters/ultimateDefinitions';
import { chargeTextureKey, releaseTextureKey, summonTextureKey } from '../../fighters/poseSheet';
import { effectCellFor } from '../effectCells';
import { summonArtFor } from '../../fighters/summonArt';

/**
 * Every piece of art the pipeline produces reaches the screen.
 *
 * This is the test the whole port is measured by. The skill pipeline cuts 226
 * images out of the twelve source sheets, and before this work 176 of them had
 * never been loaded, let alone drawn: the client asked for four cells per fighter
 * and rendered everything else as coloured rectangles. Art that exists and is
 * never shown is indistinguishable from art that was never drawn, except that
 * somebody was paid for it.
 *
 * So the rule is total, and it is enforced here rather than trusted: each cell has
 * to be claimed by exactly one of the places that can draw it. The failure mode
 * this prevents is not the obvious one — it is the next person adding a cell to a
 * sheet, regenerating the manifest, and having nothing anywhere tell them that
 * nobody draws it.
 */

/**
 * The one cell that is deliberately never drawn.
 *
 * `blade/K` is both of blade's swords in a single image. The pipeline splits it
 * into `K_weapon_blue` and `K_weapon_black`, which mount on the left and right
 * sockets of the transformed body; the delivered notes are explicit that no third
 * sword is generated. Drawing the cell they came from as well would put three
 * swords on screen, so it stays as what it is — the source the two modules were
 * derived from.
 */
const NEVER_DRAWN: Record<string, readonly string[]> = { blade: ['K'] };

/** Every cell some code path can put on screen, and which path claims it. */
function drawnCells(fighterId: string): Map<string, string> {
  const claimed = new Map<string, string>();
  const claim = (cell: string, by: string): void => {
    if (!claimed.has(cell)) claimed.set(cell, by);
  };

  const suffix = (key: string): string => key.slice(`skill-${fighterId}-`.length);

  for (const level of [1, 2, 3] as const) {
    claim(suffix(chargeTextureKey(fighterId, level)).toUpperCase(), 'charge wind-up');
    claim(effectCellFor(fighterId, level), 'charge effect');
  }
  claim(suffix(releaseTextureKey(fighterId)).toUpperCase(), 'charge release');

  const summon = summonTextureKey(fighterId);
  if (summon) claim(suffix(summon).toUpperCase(), 'companion');
  for (const [role, cell] of Object.entries(summonArtFor(fighterId) ?? {})) {
    for (const one of Array.isArray(cell) ? cell : [cell as string]) claim(one, `companion ${role}`);
  }

  const script = ultimateVisualsFor(fighterId);
  claim(script.ownerCell, 'the ultimate owner');
  for (const beat of script.beats) claim(beat.cell, `ultimate beat @${beat.atTick}`);

  for (const cell of Object.values(INSTALL_POSES[fighterId] ?? {})) claim(cell, 'transformed pose');
  for (const cell of INSTALL_ATTACHMENTS[fighterId] ?? []) claim(cell, 'mounted weapon');

  claim(suffix(ultimateDefinitionFor(fighterId).portraitTexture).toUpperCase(), 'cut-in portrait');

  return claimed;
}

describe('every skill asset is drawn', () => {
  it.each(FIGHTERS.map((f) => f.id))('%s leaves nothing on the sheet unused', (fighterId) => {
    const drawn = drawnCells(fighterId);
    const exempt = new Set(NEVER_DRAWN[fighterId] ?? []);

    const unused = SKILL_CELLS[fighterId]!.filter((cell) => !drawn.has(cell) && !exempt.has(cell));

    expect(unused, `${fighterId} has art nothing draws: ${unused.join(', ')}`).toEqual([]);
  });

  it('claims nothing that is not on the sheet', () => {
    // The mirror failure: a table naming a cell the pipeline never produced, which
    // renders as a green box rather than as nothing.
    for (const fighter of FIGHTERS) {
      const sheet = new Set(SKILL_CELLS[fighter.id]!);
      for (const [cell, by] of drawnCells(fighter.id)) {
        expect(sheet.has(cell), `${fighter.id}: ${by} wants "${cell}", which the sheet has not got`).toBe(true);
      }
    }
  });

  it('accounts for all 226 images across the roster', () => {
    const total = FIGHTERS.reduce((sum, f) => sum + SKILL_CELLS[f.id]!.length, 0);
    const drawn = FIGHTERS.reduce((sum, f) => sum + drawnCells(f.id).size, 0);
    const exempt = Object.values(NEVER_DRAWN).reduce((sum, cells) => sum + cells.length, 0);

    expect(total).toBe(226);
    expect(drawn + exempt).toBe(total);
  });

  it('exempts exactly one cell, and says why in the file', () => {
    // A growing exemption list is how "everything is used" quietly becomes
    // "everything except the fourteen we gave up on".
    expect(Object.values(NEVER_DRAWN).flat()).toHaveLength(1);
  });
});
