import { describe, it, expect } from 'vitest';
import { FIGHTERS } from '../fighterData';
import { ULTIMATE_DEFINITIONS, ultimateDefinitionFor } from '../ultimateDefinitions';
import { TICK_HZ } from '../../sim/constants';

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
      expect(definition.portraitTexture).toMatch(new RegExp(`^skill-${id}-[a-p]$`));
    }
  });

  it('rejects an unknown fighter rather than staging a blank cut-in', () => {
    expect(() => ultimateDefinitionFor('no-such-cat')).toThrow(/No ultimate definition/);
  });
});
