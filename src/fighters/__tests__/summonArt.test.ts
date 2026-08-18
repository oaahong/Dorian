import { describe, it, expect } from 'vitest';
import { SKILL_CELLS } from '../skillCells';
import { SUMMON_ART, summonArtFor, summonCellFor } from '../summonArt';
import { ultimateTimelineFor } from '../ultimateTimelines';
import type { SimSummon } from '../../sim/types';

/**
 * Which drawing a companion is showing, derived from simulation state.
 *
 * Pure, so the interesting part — a husky that visibly winds up before it bites,
 * and nine clones that are not nine copies of one picture — is testable without a
 * browser.
 */

const summon = (overrides: Partial<SimSummon> = {}): SimSummon => ({
  id: 1,
  kind: 'husky',
  x: 400,
  y: 610,
  hp: 4,
  cooldownTicks: 0,
  slot: 0,
  ...overrides,
});

const husky = SUMMON_ART.scared!;
const clones = SUMMON_ART.tempura!;

describe('the art tables', () => {
  it('names only cells the fighter actually has', () => {
    for (const [fighterId, art] of Object.entries(SUMMON_ART)) {
      const sheet = SKILL_CELLS[fighterId]!;
      for (const [role, cell] of Object.entries(art)) {
        const cells = Array.isArray(cell) ? cell : [cell as string];
        for (const one of cells) expect(sheet, `${fighterId}.${role}`).toContain(one);
      }
    }
  });

  it('covers exactly the two ultimates that summon anything', () => {
    const summoners = ['alien', 'doge', 'ya', 'tempura', 'goblin', 'salad', 'wizard', 'blade',
      'pink', 'sauce', 'scared', 'ok'].filter((id) => ultimateTimelineFor(id).summon);
    expect(Object.keys(SUMMON_ART).sort()).toEqual(summoners.sort());
  });

  it('has nothing for a fighter that summons nothing', () => {
    expect(summonArtFor('alien')).toBeNull();
  });
});

describe('the husky', () => {
  const reach = ultimateTimelineFor('scared').summon!.chase!.reach;
  const rehit = ultimateTimelineFor('scared').summon!.rehitTicks;

  it('walks while it is still closing', () => {
    const cell = summonCellFor(husky, summon(), 'scared', { hurt: false, distanceToTarget: reach + 200 });
    expect(cell).toBe(husky.walk);
  });

  it('winds up once it is in range and nearly ready', () => {
    const cell = summonCellFor(husky, summon({ cooldownTicks: 2 }), 'scared', {
      hurt: false,
      distanceToTarget: reach - 20,
    });
    expect(cell).toBe(husky.windup);
  });

  it('is mid-swing just after it connects', () => {
    const cell = summonCellFor(husky, summon({ cooldownTicks: rehit }), 'scared', {
      hurt: false,
      distanceToTarget: reach - 20,
    });
    expect(cell).toBe(husky.attack);
  });

  it('flinches when it has just been hit, whatever else it was doing', () => {
    const cell = summonCellFor(husky, summon({ cooldownTicks: rehit }), 'scared', {
      hurt: true,
      distanceToTarget: reach - 20,
    });
    expect(cell).toBe(husky.hurt);
  });

  it('shows something different for each phase of its rhythm', () => {
    // The point of the whole table: a companion drawn in one pose forever tells the
    // player nothing about when it is going to bite.
    const cells = new Set([
      summonCellFor(husky, summon(), 'scared', { hurt: false, distanceToTarget: reach + 300 }),
      summonCellFor(husky, summon({ cooldownTicks: 2 }), 'scared', { hurt: false, distanceToTarget: 40 }),
      summonCellFor(husky, summon({ cooldownTicks: rehit }), 'scared', { hurt: false, distanceToTarget: 40 }),
      summonCellFor(husky, summon({ hp: 1 }), 'scared', { hurt: true, distanceToTarget: 40 }),
    ]);
    expect(cells.size).toBe(4);
  });
});

describe('the clones', () => {
  it('gives neighbouring slots different faces', () => {
    const faces = [0, 1, 2, 3, 4].map((slot) =>
      summonCellFor(clones, summon({ kind: 'clone', slot }), 'tempura', {
        hurt: false,
        distanceToTarget: 0,
      }),
    );
    expect(new Set(faces).size).toBe(clones.variants!.length);
  });

  it('wraps rather than running off the end, with nine of them and five faces', () => {
    const cell = summonCellFor(clones, summon({ kind: 'clone', slot: 8 }), 'tempura', {
      hurt: false,
      distanceToTarget: 0,
    });
    expect(clones.variants).toContain(cell);
  });
});

describe('the husky, left behind', () => {
  const reach = ultimateTimelineFor('scared').summon!.chase!.reach;
  const rehit = ultimateTimelineFor('scared').summon!.rehitTicks;

  it('mocks a target that has run out of range', () => {
    const cell = summonCellFor(husky, summon({ cooldownTicks: rehit - 10 }), 'scared', {
      hurt: false,
      distanceToTarget: reach + 300,
    });
    expect(cell).toBe(husky.gloat);
  });

  it('goes back to walking once the bite is ready again', () => {
    const cell = summonCellFor(husky, summon({ cooldownTicks: 0 }), 'scared', {
      hurt: false,
      distanceToTarget: reach + 300,
    });
    expect(cell).toBe(husky.walk);
  });
});
