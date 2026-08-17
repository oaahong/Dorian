import { describe, it, expect } from 'vitest';
import {
  COMMAND_HISTORY_TICKS,
  DRAGON_PUNCH,
  QUARTER_CIRCLE_BACK,
  QUARTER_CIRCLE_FORWARD,
  createCommandHistory,
  directionOf,
  matchesDoubleTap,
  matchesMotion,
  recentFrames,
  recordInput,
  resetCommandHistory,
  type Direction,
} from '../command';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../input';

/**
 * Motion recognition runs inside the simulation, so it is a pure function of
 * state both clients hold. These tests are the guard on that: a motion that
 * matches on one machine and not the other is a desync, and a desync found here
 * costs seconds where one found in a match costs an evening.
 */

const NEUTRAL: InputFrame = EMPTY_INPUT;
const RIGHT = BUTTON.Right;
const LEFT = BUTTON.Left;
const DOWN = BUTTON.Down;
const UP = BUTTON.Up;

/** Feed a run of input words, oldest first. */
function history(...frames: InputFrame[]) {
  const h = createCommandHistory();
  for (const frame of frames) recordInput(h, frame);
  return h;
}

describe('directionOf', () => {
  it('reads the numpad square for every direction, facing right', () => {
    const cases: [InputFrame, Direction][] = [
      [NEUTRAL, 5],
      [RIGHT, 6],
      [LEFT, 4],
      [UP, 8],
      [DOWN, 2],
      [DOWN | RIGHT, 3],
      [DOWN | LEFT, 1],
      [UP | RIGHT, 9],
      [UP | LEFT, 7],
    ];
    for (const [frame, expected] of cases) {
      expect(directionOf(frame, 1), `frame ${frame}`).toBe(expected);
    }
  });

  it('mirrors forward and back when facing left, leaving up and down alone', () => {
    // The whole point of numpad notation: one authored motion, both sides of the
    // screen. Only the horizontal half mirrors.
    expect(directionOf(RIGHT, -1)).toBe(4);
    expect(directionOf(LEFT, -1)).toBe(6);
    expect(directionOf(DOWN | RIGHT, -1)).toBe(1);
    expect(directionOf(DOWN | LEFT, -1)).toBe(3);
    expect(directionOf(DOWN, -1)).toBe(2);
    expect(directionOf(UP, -1)).toBe(8);
  });

  it('cancels opposing directions to neutral rather than picking one', () => {
    // Keyboards report both during rollover. Picking a winner would let a fumbled
    // press spell part of a motion the player never made.
    expect(directionOf(LEFT | RIGHT, 1)).toBe(5);
    expect(directionOf(UP | DOWN, 1)).toBe(5);
    expect(directionOf(LEFT | RIGHT | DOWN, 1)).toBe(2);
  });
});

describe('the history ring', () => {
  it('reads back the most recent frames, oldest first', () => {
    const h = history(RIGHT, DOWN, LEFT);
    expect(recentFrames(h, 3)).toEqual([RIGHT, DOWN, LEFT]);
  });

  it('reports neutral for ticks before anything was recorded', () => {
    // A motion must not be completable by input from before the round began.
    expect(recentFrames(history(RIGHT), 3)).toEqual([NEUTRAL, NEUTRAL, RIGHT]);
  });

  it('keeps a constant shape once it wraps, dropping only the oldest', () => {
    const h = createCommandHistory();
    for (let i = 0; i < COMMAND_HISTORY_TICKS * 3; i += 1) recordInput(h, i & 0x1ff);
    expect(h.frames).toHaveLength(COMMAND_HISTORY_TICKS);

    const last = recentFrames(h, COMMAND_HISTORY_TICKS);
    const expected = Array.from(
      { length: COMMAND_HISTORY_TICKS },
      (_, i) => (COMMAND_HISTORY_TICKS * 3 - COMMAND_HISTORY_TICKS + i) & 0x1ff,
    );
    expect(last).toEqual(expected);
  });

  it('never reads back further than it holds', () => {
    const h = history(RIGHT, DOWN);
    expect(recentFrames(h, COMMAND_HISTORY_TICKS * 2)).toHaveLength(COMMAND_HISTORY_TICKS);
  });

  it('clears to neutral on reset, so a round cannot inherit the last one', () => {
    const h = history(DOWN, DOWN | RIGHT, RIGHT);
    expect(matchesMotion(h, QUARTER_CIRCLE_FORWARD, 1)).toBe(true);
    resetCommandHistory(h);
    expect(matchesMotion(h, QUARTER_CIRCLE_FORWARD, 1)).toBe(false);
    expect(h.head).toBe(0);
  });
});

describe('matchesMotion', () => {
  it('recognises a clean quarter-circle forward', () => {
    expect(matchesMotion(history(DOWN, DOWN | RIGHT, RIGHT), QUARTER_CIRCLE_FORWARD, 1)).toBe(true);
  });

  it('recognises the same motion mirrored when facing left', () => {
    expect(matchesMotion(history(DOWN, DOWN | LEFT, LEFT), QUARTER_CIRCLE_FORWARD, -1)).toBe(true);
  });

  it('tolerates repeated and intermediate frames, as real hands produce', () => {
    const h = history(DOWN, DOWN, DOWN | RIGHT, DOWN | RIGHT, RIGHT);
    expect(matchesMotion(h, QUARTER_CIRCLE_FORWARD, 1)).toBe(true);
  });

  it('requires the directions in order', () => {
    expect(matchesMotion(history(RIGHT, DOWN | RIGHT, DOWN), QUARTER_CIRCLE_FORWARD, 1)).toBe(false);
  });

  it('does not fire on a partial motion', () => {
    expect(matchesMotion(history(DOWN, DOWN | RIGHT), QUARTER_CIRCLE_FORWARD, 1)).toBe(false);
  });

  it('separates the forward and back quarter-circles', () => {
    const forward = history(DOWN, DOWN | RIGHT, RIGHT);
    expect(matchesMotion(forward, QUARTER_CIRCLE_BACK, 1)).toBe(false);

    const back = history(DOWN, DOWN | LEFT, LEFT);
    expect(matchesMotion(back, QUARTER_CIRCLE_BACK, 1)).toBe(true);
    expect(matchesMotion(back, QUARTER_CIRCLE_FORWARD, 1)).toBe(false);
  });

  it('recognises a dragon punch, and does not see one in a quarter-circle', () => {
    expect(matchesMotion(history(RIGHT, DOWN, DOWN | RIGHT), DRAGON_PUNCH, 1)).toBe(true);
    expect(matchesMotion(history(DOWN, DOWN | RIGHT, RIGHT), DRAGON_PUNCH, 1)).toBe(false);
  });

  it('forgets a motion once it falls outside the leniency window', () => {
    const h = history(DOWN, DOWN | RIGHT, RIGHT);
    expect(matchesMotion(h, QUARTER_CIRCLE_FORWARD, 1, 3)).toBe(true);
    for (let i = 0; i < 3; i += 1) recordInput(h, NEUTRAL);
    expect(matchesMotion(h, QUARTER_CIRCLE_FORWARD, 1, 3)).toBe(false);
  });

  it('does not read a motion out of a fighter simply walking and crouching', () => {
    // Walking forward for a while and then crouching passes through 6 and 2, but
    // in the wrong order for a quarter-circle forward.
    const h = history(RIGHT, RIGHT, RIGHT, NEUTRAL, DOWN);
    expect(matchesMotion(h, QUARTER_CIRCLE_FORWARD, 1)).toBe(false);
  });

  it('is read-only — asking twice gives the same answer', () => {
    // Phaser's JustDown consumed its edge, which is exactly why it could not be
    // used in a simulation that may evaluate the same tick more than once.
    const h = history(DOWN, DOWN | RIGHT, RIGHT);
    expect(matchesMotion(h, QUARTER_CIRCLE_FORWARD, 1)).toBe(true);
    expect(matchesMotion(h, QUARTER_CIRCLE_FORWARD, 1)).toBe(true);
    expect(matchesMotion(h, QUARTER_CIRCLE_FORWARD, 1)).toBe(true);
  });
});

describe('matchesDoubleTap', () => {
  it('sees two taps separated by a release', () => {
    expect(matchesDoubleTap(history(RIGHT, NEUTRAL, RIGHT), 6, 1)).toBe(true);
  });

  it('does not see one in a held direction', () => {
    // The departure from the upgraded build's `22`: holding crouch is not a double
    // tap, so crouching stays distinguishable from the input.
    expect(matchesDoubleTap(history(DOWN, DOWN, DOWN, DOWN), 2, 1)).toBe(false);
  });

  it('does not see one in a slowly rolled quarter-circle', () => {
    // A 236 passes through two frames of down. Under a subsequence match that
    // reads as `22`, and the upgraded build checked `22` first — so a slow
    // fireball came out as the function move instead.
    const h = history(RIGHT, DOWN, DOWN, DOWN | RIGHT, RIGHT);
    expect(matchesDoubleTap(h, 2, 1)).toBe(false);
    expect(matchesMotion(h, QUARTER_CIRCLE_FORWARD, 1)).toBe(true);
  });

  it('mirrors with facing', () => {
    expect(matchesDoubleTap(history(LEFT, NEUTRAL, LEFT), 6, -1)).toBe(true);
    expect(matchesDoubleTap(history(LEFT, NEUTRAL, LEFT), 6, 1)).toBe(false);
  });

  it('forgets taps that fall outside the window', () => {
    const h = history(RIGHT, NEUTRAL, RIGHT);
    expect(matchesDoubleTap(h, 6, 1, 3)).toBe(true);
    recordInput(h, NEUTRAL);
    recordInput(h, NEUTRAL);
    expect(matchesDoubleTap(h, 6, 1, 3)).toBe(false);
  });
});
