import type { InputFrame } from '../sim/input';

/**
 * A run of consecutive input frames.
 *
 * Frames are batched rather than sent one at a time so that a message carries a
 * few ticks of history. Over a reliable WebSocket that redundancy is merely
 * cheap; over an unreliable WebRTC data channel — the likely upgrade if latency
 * matters — it is what lets a dropped packet heal on the next one instead of
 * stalling both clients.
 */
export interface InputMessage {
  /** Tick the first frame applies to. */
  startTick: number;
  frames: InputFrame[];
  /**
   * Lowest tick the sender still needs back.
   *
   * This is what lets the sender stop repeating frames the peer already has,
   * instead of guessing a window width from the input delay. Optional because an
   * older peer sends none, and "absent" has to stay distinguishable from
   * "wants tick 0" — see `LockstepSession`.
   */
  nextWanted?: number;
  /** A checksum riding along, rather than paying for its own datagram. */
  checksum?: ChecksumMessage;
}

/** A periodic fingerprint of the sender's world, for desync detection. */
export interface ChecksumMessage {
  tick: number;
  hash: number;
}

/**
 * How a session talks to the other player.
 *
 * Deliberately tiny: everything above this line is transport-agnostic, so the
 * same LockstepSession runs over a loopback in tests, a WebSocket in production
 * and a data channel later, with no change.
 */
export interface Transport {
  sendInput(message: InputMessage): void;
  sendChecksum(message: ChecksumMessage): void;
  onInput(handler: (message: InputMessage) => void): void;
  onChecksum(handler: (message: ChecksumMessage) => void): void;
}
