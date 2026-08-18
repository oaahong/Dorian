import { describe, it, expect } from 'vitest';
import { FIGHTERS } from '../fighterData';
import { ULTIMATE_DEFINITIONS, ultimateDefinitionFor } from '../ultimateDefinitions';
import { TICK_HZ } from '../../sim/constants';
import { skillTexturesFor } from '../poseSheet';
import { ultimateVisualsFor } from '../ultimateVisuals';

/**
 * The cut-in's duration is simulation state — the world freezes for it — so this
 * file is not only about presentation. A definition that resolved to a different
 * number of ticks on two machines would desync the match.
 */

describe('ultimate definitions', () => {
  it('covers every fighter, and only them', () => {
    expect(Object.keys(ULTIMATE_DEFINITIONS).sort()).toEqual(FIGHTERS.map((f) => f.id).sort());
  });

  it('takes each ultimate’s name from the roster rather than restating it', () => {
    // One string, one home. It lives on the AttackSpec because the HUD and the
    // select screen read every move's name from there generically.
    for (const fighter of FIGHTERS) {
      expect(ultimateDefinitionFor(fighter.id).ultimateName, fighter.id)
        .toBe(fighter.ultimate.name);
    }
  });

  it('gives every fighter a distinct ultimate name', () => {
    const names = Object.values(ULTIMATE_DEFINITIONS).map((d) => d.ultimateName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('resolves the cut-in to a whole number of ticks', () => {
    // Ticks are what the simulation counts. A fractional freeze would decrement
    // past zero without ever equalling it.
    for (const definition of Object.values(ULTIMATE_DEFINITIONS)) {
      expect(Number.isInteger(definition.cutInTicks), definition.fighterId).toBe(true);
      expect(definition.cutInTicks, definition.fighterId).toBeGreaterThan(0);
    }
  });

  it('keeps every cut-in between one and three seconds', () => {
    // The whole match is frozen for this, so it is a real cost. Long enough to
    // read the line, short enough not to be the thing you dread.
    for (const definition of Object.values(ULTIMATE_DEFINITIONS)) {
      expect(definition.cutInTicks, definition.fighterId).toBeGreaterThanOrEqual(TICK_HZ);
      expect(definition.cutInTicks, definition.fighterId).toBeLessThanOrEqual(TICK_HZ * 3);
    }
  });

  it('is a pure function of the definition, not of anything measured', () => {
    // Same input, same answer, however many times it is asked — the property that
    // makes it safe to freeze the simulation for.
    for (const fighter of FIGHTERS) {
      const first = ultimateDefinitionFor(fighter.id).cutInTicks;
      expect(ultimateDefinitionFor(fighter.id).cutInTicks).toBe(first);
    }
  });

  it('gives longer lines longer cut-ins, up to the clamp', () => {
    const ya = ultimateDefinitionFor('ya'); // a long line, raised bounds
    const doge = ultimateDefinitionFor('doge'); // a short one
    expect(ya.voiceText.length).toBeGreaterThan(doge.voiceText.length);
    expect(ya.cutInTicks).toBeGreaterThan(doge.cutInTicks);
  });

  it('points every definition at art that follows the pipeline’s naming', () => {
    for (const [id, definition] of Object.entries(ULTIMATE_DEFINITIONS)) {
      expect(definition.backgroundTexture).toBe(`ultimate-bg-${id}`);
      expect(definition.portraitTexture).toMatch(new RegExp(`^skill-${id}-[a-z0-9_]+$`));
    }
  });

  it('loads every portrait it names', () => {
    for (const fighter of FIGHTERS) {
      const loadable = new Set(skillTexturesFor(fighter.id).map((t) => t.key));
      expect(loadable, fighter.id).toContain(ultimateDefinitionFor(fighter.id).portraitTexture);
    }
  });

  describe('the portrait is the fighter, and it is different for each of them', () => {
    /**
     * Every cut-in used to show cell `D`, the charge special's release frame, for
     * all twelve. That was a defensible retreat from the upgraded build, whose own
     * per-fighter picks point at effect layers — alien's is a green explosion with
     * no cat in it — but it is wrong in the other direction: `D` is the wrong
     * moment for a fighter with a dedicated ultimate pose, and for wizard it is a
     * bare magic circle 168x65 in size, stretched to a 360-pixel-tall portrait.
     *
     * So each is chosen from the art: the cell that shows the character, in the
     * state the ultimate puts them in.
     */
    it('has moved every fighter off the shared charge-release frame', () => {
      // Not a count of distinct letters — the same letter is a different picture
      // on every sheet, so counting them measures nothing. The property is that
      // none of the twelve is still on `D`, the cell they all shared.
      for (const fighter of FIGHTERS) {
        expect(ultimateDefinitionFor(fighter.id).portraitTexture, fighter.id)
          .not.toBe(`skill-${fighter.id}-d`);
      }
    });

    it('shows blade with both swords out, not the shield it threw away', () => {
      expect(ultimateDefinitionFor('blade').portraitTexture).toBe('skill-blade-j');
    });

    it('shows wizard holding the staff, not an empty magic circle', () => {
      // `D` is 168x65 and has no cat in it. So does `F`, which is what the
      // upgraded build picked.
      const portrait = ultimateDefinitionFor('wizard').portraitTexture;
      expect(portrait).not.toBe('skill-wizard-d');
      expect(portrait).not.toBe('skill-wizard-f');
      expect(portrait).toBe('skill-wizard-h');
    });

    it('shows the fighter the ultimate is about, for every one of them', () => {
      // The portrait and the body the ultimate script gives its owner are the same
      // decision — "which cell is the character mid-ultimate" — so they should not
      // be able to disagree.
      for (const fighter of FIGHTERS) {
        const portrait = ultimateDefinitionFor(fighter.id).portraitTexture;
        const owner = `skill-${fighter.id}-${ultimateVisualsFor(fighter.id).ownerCell.toLowerCase()}`;
        expect(portrait, fighter.id).toBe(owner);
      }
    });
  });

  it('rejects an unknown fighter rather than staging a blank cut-in', () => {
    expect(() => ultimateDefinitionFor('no-such-cat')).toThrow(/No ultimate definition/);
  });
});
