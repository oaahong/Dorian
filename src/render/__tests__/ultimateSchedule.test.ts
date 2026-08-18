import { describe, it, expect } from 'vitest';
import type { VisualBeat } from '../../fighters/ultimateVisuals';
import { beatsBetween, expandBeats, REPEAT_HARD_CAP } from '../ultimateSchedule';

/**
 * Which beats of an ultimate's visual script are due this frame.
 *
 * Pure, and tested here rather than through Phaser, because the interesting
 * behaviour is entirely about tick arithmetic: the renderer runs once per *frame*
 * while the script is written in *ticks*, and the fixed-step loop runs several
 * ticks in one frame whenever the client is behind.
 */

const beat = (overrides: Partial<VisualBeat> & { atTick: number }): VisualBeat => ({
  cell: 'I',
  anchor: 'owner',
  ...overrides,
});

describe('beatsBetween', () => {
  it('plays every beat in the interval when one frame covers several ticks', () => {
    // The whole reason this function exists. A client that renders at 20 fps steps
    // three ticks per frame; matching on equality would drop two beats in three,
    // and only ever on a slow machine.
    const script = [beat({ atTick: 8 }), beat({ atTick: 9 }), beat({ atTick: 10 })];

    const due = beatsBetween(script, 7, 10);

    expect(due.map((b) => b.tick)).toEqual([8, 9, 10]);
  });

  it('is a half-open interval, so a beat is never played twice across frames', () => {
    const script = [beat({ atTick: 5 }), beat({ atTick: 6 })];

    const first = beatsBetween(script, 4, 5);
    const second = beatsBetween(script, 5, 6);

    expect(first.map((b) => b.tick)).toEqual([5]);
    expect(second.map((b) => b.tick)).toEqual([6]);
  });

  it('plays nothing when no tick has passed since the last frame', () => {
    const script = [beat({ atTick: 5 })];
    expect(beatsBetween(script, 5, 5)).toEqual([]);
  });

  it('catches up a beat that was already due before the first frame arrived', () => {
    // The stage is created on the `ultimateStart` event, and the first render may
    // not come until the freeze has already burned a tick or two.
    const script = [beat({ atTick: 1 }), beat({ atTick: 2 })];
    expect(beatsBetween(script, 0, 4).map((b) => b.tick)).toEqual([1, 2]);
  });

  it('orders beats by tick, then by their position in the script', () => {
    const script = [beat({ atTick: 9, cell: 'B' }), beat({ atTick: 8 }), beat({ atTick: 9, cell: 'A' })];

    const due = beatsBetween(script, 0, 20);

    expect(due.map((b) => [b.tick, b.cell])).toEqual([
      [8, 'I'],
      [9, 'B'],
      [9, 'A'],
    ]);
  });
});

describe('repeating beats', () => {
  it('expands a repeat into one beat per interval, up to and including the last', () => {
    const script = [beat({ atTick: 10, repeat: { everyTicks: 5, untilTick: 25, max: 99 } })];
    expect(expandBeats(script).map((b) => b.tick)).toEqual([10, 15, 20, 25]);
  });

  it('stops at `max` occurrences however long the window is', () => {
    // Bounded because these become live GameObjects: ok's flurry and salad's
    // scatter are the two that could otherwise grow with the timeline.
    const script = [beat({ atTick: 0, repeat: { everyTicks: 1, untilTick: 600, max: 12 } })];
    expect(expandBeats(script)).toHaveLength(12);
  });

  it('refuses a repeat that would outrun the hard cap, whatever it asks for', () => {
    const script = [
      beat({ atTick: 0, repeat: { everyTicks: 1, untilTick: 100_000, max: Number.MAX_SAFE_INTEGER } }),
    ];
    expect(expandBeats(script).length).toBeLessThanOrEqual(REPEAT_HARD_CAP);
  });

  it('treats a non-positive interval as a single beat rather than looping forever', () => {
    const script = [beat({ atTick: 3, repeat: { everyTicks: 0, untilTick: 40, max: 10 } })];
    expect(expandBeats(script).map((b) => b.tick)).toEqual([3]);
  });

  it('hands repeats to beatsBetween like any other beat', () => {
    const script = [beat({ atTick: 10, repeat: { everyTicks: 5, untilTick: 25, max: 99 } })];
    expect(beatsBetween(script, 12, 22).map((b) => b.tick)).toEqual([15, 20]);
  });

  it('gives each occurrence its own identity, so the shell can key on it', () => {
    const script = [beat({ atTick: 10, repeat: { everyTicks: 5, untilTick: 20, max: 99 } })];
    const ids = expandBeats(script).map((b) => b.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('script length', () => {
  it('reports the last tick anything happens on', () => {
    const script = [beat({ atTick: 4 }), beat({ atTick: 30, repeat: { everyTicks: 10, untilTick: 55, max: 99 } })];
    expect(expandBeats(script).at(-1)!.tick).toBe(50);
  });
});
