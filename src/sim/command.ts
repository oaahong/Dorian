import { BUTTON, isDown, type InputFrame } from './input';

/**
 * Motion inputs — 236, 214, 623, double taps — evaluated inside the simulation.
 *
 * The upgraded build parsed these in the controller, from a `CommandParser` class
 * reading an `InputBuffer` of snapshots that carried `Set`s of pressed keys. None
 * of that can survive lockstep: state held outside `SimWorld` is state the other
 * client never receives and a rollback never restores, so two machines would
 * disagree about whether a fireball came out and the desync would surface a
 * second later as a checksum mismatch with no obvious cause.
 *
 * So the history lives in `SimFighter` as a fixed-length ring of raw input words,
 * it is folded into the checksum with everything else, and the matching below is a
 * pure function of it. Recording is the *only* mutation; every question asked of
 * the history is read-only and can be asked as many times per tick as needed.
 *
 * See docs/sim-spec.md §2.
 */

/**
 * How many ticks of input each fighter remembers.
 *
 * The upgraded build's buffer was 30 and nothing looks back further than
 * `MOTION_LENIENCY`, so this is roughly three times what any current query needs.
 * It costs two bytes a tick per fighter and buys room for longer motions later.
 */
export const COMMAND_HISTORY_TICKS = 30;

/**
 * Ticks a motion may be spread across. At 60 Hz this is about 133 ms, which is
 * the standard input window for a quarter-circle in the genre — long enough to be
 * humanly reachable, short enough that walking forward and later crouching does
 * not read as a fireball.
 */
export const MOTION_LENIENCY = 8;

/** Ticks a double tap may be spread across. Deliberately tighter than a motion. */
export const DOUBLE_TAP_LENIENCY = 8;

/**
 * A direction in numpad notation, relative to the way the fighter is facing:
 *
 * ```text
 *   7 8 9        7 = up-back      8 = up        9 = up-forward
 *   4 5 6        4 = back         5 = neutral   6 = forward
 *   1 2 3        1 = down-back    2 = down      3 = down-forward
 * ```
 *
 * Facing-relative rather than absolute, so one authored motion works from both
 * sides of the screen — the whole reason the genre uses this notation.
 */
export type Direction = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Motions, in the notation they are spoken in. */
export const QUARTER_CIRCLE_FORWARD: readonly Direction[] = [2, 3, 6];
export const QUARTER_CIRCLE_BACK: readonly Direction[] = [2, 1, 4];
export const DRAGON_PUNCH: readonly Direction[] = [6, 2, 3];

/**
 * Read one input word as a facing-relative direction.
 *
 * Left and right held together cancel to neutral, matching `moveAxis` — holding
 * both is what a keyboard reports mid-rollover, and treating it as a direction
 * would let a fumbled press spell part of a motion.
 */
export function directionOf(frame: InputFrame, facing: 1 | -1): Direction {
  const left = isDown(frame, BUTTON.Left);
  const right = isDown(frame, BUTTON.Right);
  const up = isDown(frame, BUTTON.Up);
  const down = isDown(frame, BUTTON.Down);

  const horizontal = left === right ? 0 : left ? -1 : 1;
  // `facing` is +1 when the opponent is to the right, so forward is right.
  const forward = horizontal === 0 ? 0 : horizontal === facing ? 1 : -1;

  if (up && down) return 5; // Same rollover argument as left+right.
  if (down) return forward > 0 ? 3 : forward < 0 ? 1 : 2;
  if (up) return forward > 0 ? 9 : forward < 0 ? 7 : 8;
  return forward > 0 ? 6 : forward < 0 ? 4 : 5;
}

/**
 * The per-fighter input ring.
 *
 * Fixed length with a write head rather than a growing array that shifts: the
 * shape never changes, so it snapshots, clones and hashes at a constant cost, and
 * there is no allocation on the hot path.
 */
export interface CommandHistory {
  /** Raw input words, oldest-to-newest only when read through `recent`. */
  frames: number[];
  /** Index the *next* write goes to. */
  head: number;
}

export function createCommandHistory(): CommandHistory {
  return { frames: new Array<number>(COMMAND_HISTORY_TICKS).fill(0), head: 0 };
}

export function resetCommandHistory(history: CommandHistory): void {
  history.frames.fill(0);
  history.head = 0;
}

/** Record one tick. The only function here that writes. */
export function recordInput(history: CommandHistory, frame: InputFrame): void {
  history.frames[history.head] = frame;
  history.head = (history.head + 1) % COMMAND_HISTORY_TICKS;
}

/**
 * The last `count` recorded words, oldest first.
 *
 * Before the ring has filled, the unwritten slots read as neutral rather than as
 * absent. That is deliberate: a motion cannot be completed by input from before
 * the round began, and neutral is what a released controller reports anyway.
 */
export function recentFrames(history: CommandHistory, count: number): number[] {
  const size = Math.min(count, COMMAND_HISTORY_TICKS);
  const out = new Array<number>(size);
  for (let i = 0; i < size; i += 1) {
    const index = (history.head - size + i + COMMAND_HISTORY_TICKS * 2) % COMMAND_HISTORY_TICKS;
    out[i] = history.frames[index]!;
  }
  return out;
}

/**
 * Whether the recent history spells `motion`.
 *
 * The directions must appear in order but need not be adjacent, so a player who
 * rolls 2, 3, 3, 6 still throws a fireball — real hands pass through intermediate
 * frames and a strict adjacency test would reject almost every human input.
 */
export function matchesMotion(
  history: CommandHistory,
  motion: readonly Direction[],
  facing: 1 | -1,
  leniency: number = MOTION_LENIENCY,
): boolean {
  if (motion.length === 0) return true;
  const frames = recentFrames(history, leniency);
  let next = 0;
  for (const frame of frames) {
    if (directionOf(frame, facing) === motion[next]) {
      next += 1;
      if (next === motion.length) return true;
    }
  }
  return false;
}

/**
 * How far apart two buttons of a chord may be pressed and still count as one.
 *
 * Three ticks — fifty milliseconds. A chord is two buttons meant to arrive
 * together, and no hand presses two keys on the same tick reliably. Without the
 * window the near-misses do not fail, which would be survivable; they come out as
 * the *individual* moves instead, so asking for a parry gives you a light attack
 * and whatever punish follows it.
 */
export const CHORD_LENIENCY = 3;

/**
 * Whether both buttons are held now and at least one of them arrived recently.
 *
 * The second half is what stops a chord from re-firing. Both-held alone is true
 * for as long as the player keeps holding, so it would ask for the move again on
 * every tick of its own recovery; requiring a rising edge inside the window makes
 * it a single request, the same way `justPressed` does for one button.
 */
export function matchesChord(
  history: CommandHistory,
  a: number,
  b: number,
  leniency: number = CHORD_LENIENCY,
): boolean {
  const frames = recentFrames(history, leniency + 1);
  const now = frames[frames.length - 1];
  if (now === undefined || !isDown(now, a) || !isDown(now, b)) return false;

  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1]!;
    const frame = frames[i]!;
    const pressedA = isDown(frame, a) && !isDown(previous, a);
    const pressedB = isDown(frame, b) && !isDown(previous, b);
    if (pressedA || pressedB) return true;
  }
  return false;
}

/**
 * Whether `direction` was tapped twice — pressed, released, pressed again.
 *
 * Counting rising edges rather than matching `[2, 2]` as a motion is a deliberate
 * departure from the upgraded build, whose `22` was a subsequence match and so was
 * satisfied by simply *holding* down for two ticks. That made crouching indis-
 * tinguishable from the input, and worse, a slowly-rolled 236 passes through two
 * frames of down and would have been eaten by `22` — which its own precedence
 * order checks first. Requiring a release between the taps separates the two.
 */
export function matchesDoubleTap(
  history: CommandHistory,
  direction: Direction,
  facing: 1 | -1,
  leniency: number = DOUBLE_TAP_LENIENCY,
): boolean {
  const frames = recentFrames(history, leniency);
  let taps = 0;
  let wasHeld = false;
  for (const frame of frames) {
    const held = directionOf(frame, facing) === direction;
    if (held && !wasHeld) taps += 1;
    wasHeld = held;
  }
  return taps >= 2;
}
