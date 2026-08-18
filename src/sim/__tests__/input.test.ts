import { describe, it, expect } from 'vitest';
import {
  BUTTON,
  EMPTY_INPUT,
  INPUT_FRAME_MASK,
  type ButtonState,
  isDown,
  justPressed,
  moveAxis,
  packInput,
  unpackInput,
} from '../input';

/**
 * The input frame is the network payload: one 16-bit word of raw button state per
 * player per tick. Nothing derived (jumpPressed, block, which motion was spelled)
 * belongs in it — those are recomputed inside the simulation so a resimulation
 * reaches the same answer. See docs/gameplay/sim-spec.md §2.
 */

const NONE: ButtonState = {
  left: false, right: false, up: false, down: false,
  light: false, heavy: false, special: false, throw: false, ultimate: false,
};

describe('button bits', () => {
  it('assigns each button a distinct bit inside the frame word', () => {
    const bits = Object.values(BUTTON);
    expect(new Set(bits).size).toBe(bits.length);
    for (const bit of bits) {
      expect(bit).toBeGreaterThan(0);
      expect(bit & (bit - 1), `${bit} is not a single bit`).toBe(0);
      expect(bit).toBeLessThanOrEqual(0xffff);
    }
  });

  it('fits every button in the frame mask', () => {
    const all = Object.values(BUTTON).reduce((acc, bit) => acc | bit, 0);
    expect(all & ~INPUT_FRAME_MASK).toBe(0);
  });

  it('treats an empty frame as no buttons held', () => {
    expect(EMPTY_INPUT).toBe(0);
    for (const bit of Object.values(BUTTON)) {
      expect(isDown(EMPTY_INPUT, bit)).toBe(false);
    }
  });
});

describe('packInput / unpackInput', () => {
  it('round-trips every combination of the nine buttons', () => {
    for (let frame = 0; frame <= INPUT_FRAME_MASK; frame += 1) {
      expect(packInput(unpackInput(frame))).toBe(frame);
    }
  });

  it('packs an all-buttons-held state into the full mask', () => {
    const all: ButtonState = {
      left: true, right: true, up: true, down: true,
      light: true, heavy: true, special: true, throw: true, ultimate: true,
    };
    expect(packInput(all)).toBe(INPUT_FRAME_MASK);
  });

  it('packs nothing held as zero', () => {
    expect(packInput(NONE)).toBe(EMPTY_INPUT);
  });

  it('sets exactly the requested bit for a single button', () => {
    expect(packInput({ ...NONE, light: true })).toBe(BUTTON.Light);
    expect(packInput({ ...NONE, down: true })).toBe(BUTTON.Down);
  });

  it('never produces a frame outside the 16-bit wire field', () => {
    for (let frame = 0; frame <= INPUT_FRAME_MASK; frame += 1) {
      expect(frame & ~0xffff).toBe(0);
    }
  });
});

describe('isDown', () => {
  it('reports only the buttons actually held', () => {
    const frame = packInput({ ...NONE, right: true, special: true });
    expect(isDown(frame, BUTTON.Right)).toBe(true);
    expect(isDown(frame, BUTTON.Special)).toBe(true);
    expect(isDown(frame, BUTTON.Left)).toBe(false);
    expect(isDown(frame, BUTTON.Down)).toBe(false);
  });
});

describe('justPressed', () => {
  /**
   * Rising-edge detection replaces Phaser's `JustDown()`, which *consumes* the
   * edge flag and so can only be read once per tick — fatal for any resimulation.
   * This is a pure function of (current, previous), so it can be evaluated as
   * often as needed.
   */
  it('fires on the tick a button goes down', () => {
    expect(justPressed(BUTTON.Light, EMPTY_INPUT, BUTTON.Light)).toBe(true);
  });

  it('does not fire while the button is held', () => {
    expect(justPressed(BUTTON.Light, BUTTON.Light, BUTTON.Light)).toBe(false);
  });

  it('does not fire on release', () => {
    expect(justPressed(EMPTY_INPUT, BUTTON.Light, BUTTON.Light)).toBe(false);
  });

  it('fires again after a release and a re-press', () => {
    expect(justPressed(BUTTON.Light, EMPTY_INPUT, BUTTON.Light)).toBe(true);
    expect(justPressed(BUTTON.Light, BUTTON.Light, BUTTON.Light)).toBe(false);
    expect(justPressed(EMPTY_INPUT, BUTTON.Light, BUTTON.Light)).toBe(false);
    expect(justPressed(BUTTON.Light, EMPTY_INPUT, BUTTON.Light)).toBe(true);
  });

  it('is unaffected by other buttons changing in the same tick', () => {
    const previous = packInput({ ...NONE, right: true });
    const current = packInput({ ...NONE, right: true, heavy: true });
    expect(justPressed(current, previous, BUTTON.Heavy)).toBe(true);
    expect(justPressed(current, previous, BUTTON.Right)).toBe(false);
  });
});

describe('moveAxis', () => {
  it('returns 0 when neither direction is held', () => {
    expect(moveAxis(EMPTY_INPUT)).toBe(0);
  });

  it('returns -1 for left and +1 for right', () => {
    expect(moveAxis(BUTTON.Left)).toBe(-1);
    expect(moveAxis(BUTTON.Right)).toBe(1);
  });

  it('cancels to 0 when both directions are held', () => {
    // Matches the current PlayerController: `left === right ? 0 : ...`.
    expect(moveAxis(BUTTON.Left | BUTTON.Right)).toBe(0);
  });

  it('ignores buttons other than left and right', () => {
    expect(moveAxis(BUTTON.Left | BUTTON.Down | BUTTON.Special)).toBe(-1);
  });
});
