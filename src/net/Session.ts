import { EMPTY_INPUT, INPUT_FRAME_MASK, type InputFrame } from '../sim/input';
import type { PlayerIndex } from '../sim/types';

/**
 * How many ticks of input history are kept. At 60 Hz this is about four seconds,
 * far more than any tolerable stall, and it is also the window a rollback
 * implementation would resimulate within.
 */
export const INPUT_RING_SIZE = 256;

export type SessionStatus = 'ok' | 'waiting' | 'desync' | 'disconnected';

/**
 * Decides whether a given tick can be simulated yet.
 *
 * This is the whole seam between local and online play. BattleScene samples the
 * keyboard, hands the frame over, and asks for the pair to step with; whether the
 * opponent's frame came from a second keyboard, the CPU or a socket is not
 * something the scene knows.
 */
export interface Session {
  readonly localPlayer: PlayerIndex;
  readonly status: SessionStatus;
  readonly inputDelay: number;

  /** Offer the frame sampled locally on `tick`. */
  submitLocalInput(tick: number, input: InputFrame): void;

  /** Both players' frames for `tick`, or null if the simulation must wait. */
  inputsForTick(tick: number): [InputFrame, InputFrame] | null;
}

/**
 * A fixed-size ring of input frames, keyed by tick.
 *
 * Each slot stores the tick it holds so a stale entry from a previous lap cannot
 * be mistaken for a fresh one — the bug this would otherwise cause is a
 * four-second-old input replaying itself, which looks like a desync but is not.
 */
export class InputRing {
  private readonly frames = new Int16Array(INPUT_RING_SIZE);
  private readonly ticks = new Int32Array(INPUT_RING_SIZE).fill(-1);

  set(tick: number, input: InputFrame): void {
    const slot = tick % INPUT_RING_SIZE;
    this.frames[slot] = input & INPUT_FRAME_MASK;
    this.ticks[slot] = tick;
  }

  has(tick: number): boolean {
    return this.ticks[tick % INPUT_RING_SIZE] === tick;
  }

  get(tick: number): InputFrame | null {
    const slot = tick % INPUT_RING_SIZE;
    return this.ticks[slot] === tick ? this.frames[slot]! : null;
  }

  /** Fill `[0, tick)` with neutral input, for the ticks before the delay window. */
  primeUntil(tick: number): void {
    for (let i = 0; i < tick; i += 1) this.set(i, EMPTY_INPUT);
  }
}
