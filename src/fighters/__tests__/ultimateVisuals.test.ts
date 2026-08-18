import { describe, it, expect } from 'vitest';
import { FIGHTERS } from '../fighterData';
import { SKILL_CELLS } from '../skillCells';
import { ULTIMATE_VISUALS, ultimateVisualsFor } from '../ultimateVisuals';
import { ultimateTimelineFor } from '../ultimateTimelines';
import { expandBeats } from '../../render/ultimateSchedule';

/**
 * The art side of an ultimate, checked against the two things it has to agree
 * with: the sheet the cells come from, and the timeline the hitboxes are on.
 *
 * Neither agreement is visible by reading the file. A mistyped cell is a texture
 * that silently fails to load, and a beat on the wrong tick is a hit with no
 * picture — both of which are found by playing the game twelve times, or by this.
 */

describe('every fighter has a visual script', () => {
  it('covers the whole roster', () => {
    expect(Object.keys(ULTIMATE_VISUALS).sort()).toEqual(FIGHTERS.map((f) => f.id).sort());
  });

  it('gives every ultimate something to draw', () => {
    for (const fighter of FIGHTERS) {
      expect(ultimateVisualsFor(fighter.id).beats.length, fighter.id).toBeGreaterThan(0);
    }
  });
});

describe('every cell exists on the fighter that uses it', () => {
  it.each(FIGHTERS.map((f) => f.id))('%s', (fighterId) => {
    const cells = SKILL_CELLS[fighterId]!;
    const script = ultimateVisualsFor(fighterId);

    expect(cells, `${fighterId} owner cell`).toContain(script.ownerCell);
    for (const beat of script.beats) {
      expect(cells, `${fighterId} beat at tick ${beat.atTick}`).toContain(beat.cell);
    }
  });
});

describe('the beats and the hitboxes share a clock', () => {
  it.each(FIGHTERS.map((f) => f.id))('%s keeps every beat inside its timeline', (fighterId) => {
    const timeline = ultimateTimelineFor(fighterId);
    for (const beat of expandBeats(ultimateVisualsFor(fighterId).beats)) {
      expect(beat.tick, `${fighterId} @${beat.tick}`).toBeGreaterThan(0);
      expect(beat.tick, `${fighterId} @${beat.tick}`).toBeLessThanOrEqual(timeline.ticks);
    }
  });

  it.each(FIGHTERS.map((f) => f.id))('%s draws something for every hit it lands', (fighterId) => {
    // A phase with no art near it is a box that hurts with nothing on screen —
    // unreadable, and indistinguishable from a bug.
    const timeline = ultimateTimelineFor(fighterId);
    const beats = expandBeats(ultimateVisualsFor(fighterId).beats);

    for (const phase of timeline.phases) {
      const nearby = beats.some((beat) => Math.abs(beat.tick - phase.from) <= 6);
      expect(nearby, `${fighterId} "${phase.label}" at tick ${phase.from} has no art`).toBe(true);
    }
  });
});

describe('bounded cost', () => {
  it.each(FIGHTERS.map((f) => f.id))('%s cannot spawn an unbounded number of objects', (fighterId) => {
    // Every occurrence becomes a live display object. The budget is per ultimate,
    // and two of them run for ten seconds.
    expect(expandBeats(ultimateVisualsFor(fighterId).beats).length).toBeLessThanOrEqual(60);
  });

  it('gives every repeating beat an explicit ceiling', () => {
    for (const fighter of FIGHTERS) {
      for (const beat of ultimateVisualsFor(fighter.id).beats) {
        if (!beat.repeat) continue;
        expect(beat.repeat.max, `${fighter.id} @${beat.atTick}`).toBeLessThanOrEqual(16);
      }
    }
  });
});

describe('the corrections to the upgraded build', () => {
  /**
   * The upgraded build hands three fighters an effect layer as their body. These
   * are pinned so a future "port it faithfully" pass cannot quietly undo them.
   */
  it('does not draw alien as a green explosion with no cat in it', () => {
    expect(ultimateVisualsFor('alien').ownerCell).toBe('I');
  });

  it('does not draw sauce as a puddle on the floor', () => {
    expect(ultimateVisualsFor('sauce').ownerCell).toBe('J');
  });

  it('does not draw ya as an empty crowd ring', () => {
    expect(ultimateVisualsFor('ya').ownerCell).toBe('I');
  });

  it('leaves the two summon ultimates their own bodies once control returns', () => {
    // tempura and scared hand control back on tick 20 and go back to fighting, so
    // an override that outlived the move would freeze them mid-pose.
    for (const fighterId of ['tempura', 'scared']) {
      expect(ultimateTimelineFor(fighterId).releaseTick).toBe(20);
    }
  });
});
