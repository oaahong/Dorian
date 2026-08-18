/**
 * One tick of raw controller state, packed into a 16-bit word.
 *
 * This is the network payload for lockstep, so it carries only what a physical
 * controller reports. Everything derived — jump/attack edges, whether the player
 * is blocking, which motion a direction history spells — is recomputed inside the
 * simulation from this plus the previous frames, so that a resimulation of the
 * same bytes reaches the same result.
 *
 * It was a single byte with one bit spare until the upgraded build's control
 * scheme arrived. That needs two more physical buttons — a throw and a dedicated
 * ultimate — and nine bits do not fit in eight. Packing the four directions down
 * to a 4-bit numpad value would have bought exactly the bit back, at the price of
 * making `moveAxis` and the block check decode a field instead of testing a bit,
 * on the hot path, to save one byte per tick on a 60 Hz stream. Two bytes it is.
 *
 * See docs/gameplay/sim-spec.md §2.
 */

export const BUTTON = {
  Left: 1 << 0,
  Right: 1 << 1,
  Up: 1 << 2,
  Down: 1 << 3,
  Light: 1 << 4,
  Heavy: 1 << 5,
  Special: 1 << 6,
  Throw: 1 << 7,
  Ultimate: 1 << 8,
} as const;

export type Button = (typeof BUTTON)[keyof typeof BUTTON];

/** All defined button bits. Bits 9..15 are unused and reserved. */
export const INPUT_FRAME_MASK = 0x1ff;

/** A packed frame of button state. Always in `0..INPUT_FRAME_MASK`. */
export type InputFrame = number;

export const EMPTY_INPUT: InputFrame = 0;

export interface ButtonState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  light: boolean;
  heavy: boolean;
  special: boolean;
  throw: boolean;
  ultimate: boolean;
}

export function packInput(state: ButtonState): InputFrame {
  return (
    (state.left ? BUTTON.Left : 0) |
    (state.right ? BUTTON.Right : 0) |
    (state.up ? BUTTON.Up : 0) |
    (state.down ? BUTTON.Down : 0) |
    (state.light ? BUTTON.Light : 0) |
    (state.heavy ? BUTTON.Heavy : 0) |
    (state.special ? BUTTON.Special : 0) |
    (state.throw ? BUTTON.Throw : 0) |
    (state.ultimate ? BUTTON.Ultimate : 0)
  );
}

export function unpackInput(frame: InputFrame): ButtonState {
  return {
    left: isDown(frame, BUTTON.Left),
    right: isDown(frame, BUTTON.Right),
    up: isDown(frame, BUTTON.Up),
    down: isDown(frame, BUTTON.Down),
    light: isDown(frame, BUTTON.Light),
    heavy: isDown(frame, BUTTON.Heavy),
    special: isDown(frame, BUTTON.Special),
    throw: isDown(frame, BUTTON.Throw),
    ultimate: isDown(frame, BUTTON.Ultimate),
  };
}

export function isDown(frame: InputFrame, button: Button): boolean {
  return (frame & button) !== 0;
}

/**
 * Rising-edge detection, replacing `Phaser.Input.Keyboard.JustDown()`.
 *
 * Phaser's version *consumes* the edge flag, so it can only be read once per tick
 * and returns false on a second read — which makes any resimulation see a
 * different input than the original run. This is a pure function of the current
 * and previous frames and can be evaluated as many times as needed.
 */
export function justPressed(current: InputFrame, previous: InputFrame, button: Button): boolean {
  return (current & ~previous & button) !== 0;
}

/**
 * Horizontal movement axis. Holding both directions cancels to neutral, matching
 * the original `left === right ? 0 : left ? -1 : 1`.
 */
export function moveAxis(frame: InputFrame): -1 | 0 | 1 {
  const left = isDown(frame, BUTTON.Left);
  const right = isDown(frame, BUTTON.Right);
  if (left === right) return 0;
  return left ? -1 : 1;
}
