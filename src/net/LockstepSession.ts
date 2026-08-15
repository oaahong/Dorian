import { EMPTY_INPUT, INPUT_FRAME_MASK, type InputFrame } from '../sim/input';
import type { PlayerIndex } from '../sim/types';
import { InputRing, INPUT_RING_SIZE, type Session, type SessionStatus } from './Session';
import type { ChecksumMessage, InputMessage, Transport } from './Transport';

/**
 * Input-delay lockstep.
 *
 * Both clients run the same deterministic simulation over the same inputs, so
 * nothing but button state crosses the wire — about six bytes a tick. The cost is
 * that a tick cannot be simulated until both players' frames for it are known,
 * which is why local input is scheduled `inputDelay` ticks ahead: the frame has
 * that long to reach the other machine before anyone has to wait for it.
 *
 * Three ticks (50 ms) covers a round trip under about 100 ms. Beyond that the
 * session stalls rather than guessing — guessing is rollback's job, and this
 * class is deliberately the simpler thing that can be upgraded to it once the
 * world snapshots (which it already does).
 */

export interface LockstepOptions {
  localPlayer: PlayerIndex;
  inputDelay: number;
  transport: Transport;
  /**
   * How many recent frames each message repeats. Defaults to three times the
   * input delay, which is what makes a lost message recoverable — see the note
   * on the field.
   */
  redundancy?: number;
  /** Injected so tests can drive the retransmission throttle deterministically. */
  now?: () => number;
}

/**
 * Frames repeated per message, as a multiple of the input delay.
 *
 * This has to exceed the delay with room to spare. A client may legitimately be
 * `inputDelay` ticks behind its opponent, so if the window is only that wide, the
 * frames it still needs are already sliding out of the opponent's window — and
 * the channel is deliberately unreliable, so a single dropped message becomes
 * unrecoverable and the match deadlocks with each side waiting for frames the
 * other will never send again.
 *
 * Setting the window equal to the delay is exactly the trap: it looks like
 * "enough to cover the delay" and leaves zero margin. Three times costs a few
 * dozen bytes a message.
 */
const REDUNDANCY_PER_DELAY_TICK = 3;
const MIN_REDUNDANCY = 12;

/**
 * Shortest gap between retransmissions while stalled, in milliseconds.
 *
 * Throttled by time rather than by call count. Counting calls ties the rate to
 * the frame rate, and a stalled client only gets one call per rendered frame —
 * on a client managing 17 fps that worked out at two retransmissions a second.
 * The data channel is deliberately unreliable, so a dropped message then cost
 * half a second of standing still, and a match spent almost all of its time
 * waiting.
 *
 * At roughly sixty a second the cost is about half a kilobyte a second, and it is
 * still under the server's flood protection.
 */
const RESEND_INTERVAL_MS = 16;

export class LockstepSession implements Session {
  readonly localPlayer: PlayerIndex;
  readonly inputDelay: number;

  private readonly transport: Transport;
  private readonly redundancy: number;
  private readonly now: () => number;
  private readonly local = new InputRing();
  private readonly remote = new InputRing();
  /** Frames recently sent, resent as redundancy. */
  private readonly recent: InputFrame[] = [];
  private recentStartTick = 0;

  private localChecksums = new Map<number, number>();
  private remoteChecksums = new Map<number, number>();

  private currentStatus: SessionStatus = 'ok';
  private stalled = 0;
  private lastSendAtMs = 0;
  private divergedAt: number | null = null;
  /** Highest tick already handed to the simulation; frames for it are now history. */
  private consumedThrough = -1;

  constructor(options: LockstepOptions) {
    this.localPlayer = options.localPlayer;
    this.inputDelay = Math.max(0, Math.floor(options.inputDelay));
    this.transport = options.transport;
    this.redundancy =
      options.redundancy ?? Math.max(MIN_REDUNDANCY, this.inputDelay * REDUNDANCY_PER_DELAY_TICK);
    this.now = options.now ?? (() => Date.now());

    // The opening ticks have no sampled input behind them; both seats are neutral
    // so the match can start rather than deadlock on frames that never existed.
    this.local.primeUntil(this.inputDelay);
    this.remote.primeUntil(this.inputDelay);

    this.transport.onInput((message) => this.acceptRemoteInput(message));
    this.transport.onChecksum((message) => this.acceptRemoteChecksum(message));
  }

  get status(): SessionStatus {
    return this.currentStatus;
  }

  /** Consecutive calls that have had to wait, for a "waiting for opponent" notice. */
  get stalledTicks(): number {
    return this.stalled;
  }

  get desyncTick(): number | null {
    return this.divergedAt;
  }

  /**
   * Offer the frame sampled locally on `tick`. The first offer for a tick wins.
   *
   * Once a frame has been transmitted it is final. The opponent keeps the first
   * value it receives for a tick and ignores any later one, so changing our mind
   * afterwards means the two clients simulate that tick from different inputs —
   * a desync, and one reachable from ordinary play: a stalled client keeps being
   * asked for its current buttons, and a player pressing keys during the stall
   * gives a different answer each time.
   */
  submitLocalInput(tick: number, input: InputFrame): void {
    if (this.currentStatus === 'disconnected') return;
    const appliesAt = tick + this.inputDelay;

    if (this.local.get(appliesAt) !== null) {
      // Already settled. The repeat still signals that the caller is stalled, so
      // it is taken as a cue to retransmit in case the original was lost.
      this.resend();
      return;
    }

    this.local.set(appliesAt, input & INPUT_FRAME_MASK);
    this.pushRecent(appliesAt, input & INPUT_FRAME_MASK);
    this.transmit();
  }

  /**
   * Retransmit the recent window.
   *
   * Throttled, because a stalled client has nothing new to say and would
   * otherwise repeat itself sixty times a second — enough to trip a server's
   * flood protection. Going fully silent is not an option either: if the message
   * carrying the frame the opponent needs was the one that got lost, both would
   * wait forever.
   */
  resend(): void {
    if (this.currentStatus === 'disconnected') return;
    if (this.now() - this.lastSendAtMs < RESEND_INTERVAL_MS) return;
    this.transmit();
  }

  private transmit(): void {
    if (this.recent.length === 0) return;
    this.lastSendAtMs = this.now();
    this.transport.sendInput({ startTick: this.recentStartTick, frames: [...this.recent] });
  }

  inputsForTick(tick: number): [InputFrame, InputFrame] | null {
    if (this.currentStatus === 'disconnected' || this.currentStatus === 'desync') return null;

    const localFrame = this.local.get(tick);
    const remoteFrame = this.remote.get(tick);
    if (localFrame === null || remoteFrame === null) {
      this.stalled += 1;
      this.currentStatus = 'waiting';
      return null;
    }

    this.stalled = 0;
    this.currentStatus = 'ok';
    this.consumedThrough = Math.max(this.consumedThrough, tick);
    return this.localPlayer === 0 ? [localFrame, remoteFrame] : [remoteFrame, localFrame];
  }

  /** Fold in a batch of the opponent's frames. Safe to call with anything. */
  acceptRemoteInput(message: InputMessage): void {
    if (this.currentStatus === 'disconnected') return;
    if (!Number.isInteger(message.startTick) || message.startTick < 0) return;
    if (!Array.isArray(message.frames)) return;

    for (let i = 0; i < message.frames.length; i += 1) {
      const tick = message.startTick + i;
      // A frame for a tick already simulated cannot be applied without rewriting
      // history, and one too far ahead would wrap the ring onto a live tick.
      if (tick <= this.consumedThrough) continue;
      if (tick > this.consumedThrough + INPUT_RING_SIZE) continue;
      if (this.remote.has(tick)) continue;

      const frame = message.frames[i];
      if (typeof frame !== 'number' || !Number.isFinite(frame)) continue;
      this.remote.set(tick, frame & INPUT_FRAME_MASK);
    }
  }

  /** Publish this client's world fingerprint and compare it with the opponent's. */
  recordChecksum(tick: number, hash: number): void {
    this.localChecksums.set(tick, hash >>> 0);
    this.transport.sendChecksum({ tick, hash: hash >>> 0 });
    this.compareChecksums(tick);
  }

  acceptRemoteChecksum(message: ChecksumMessage): void {
    if (!Number.isInteger(message.tick)) return;
    this.remoteChecksums.set(message.tick, message.hash >>> 0);
    this.compareChecksums(message.tick);
  }

  disconnect(): void {
    this.currentStatus = 'disconnected';
  }

  /**
   * A checksum pair is only meaningful once both halves exist. The two clients do
   * not run in step with each other in wall-clock terms, so the remote hash
   * routinely arrives before the local one has been computed.
   */
  private compareChecksums(tick: number): void {
    if (this.divergedAt !== null) return;
    const mine = this.localChecksums.get(tick);
    const theirs = this.remoteChecksums.get(tick);
    if (mine === undefined || theirs === undefined) return;

    if (mine !== theirs) {
      this.divergedAt = tick;
      this.currentStatus = 'desync';
    }
    this.localChecksums.delete(tick);
    this.remoteChecksums.delete(tick);
  }

  /**
   * Maintain the sliding window of recent frames that each message repeats.
   *
   * The re-submit case matters more than it looks: a stalled client keeps
   * offering the same tick every frame while it waits. Treating that as a gap
   * would reset the window to a single frame, so the messages it sends while
   * stalled would stop carrying the very frames the opponent is missing — and on
   * a lossy link the two clients would wait on each other forever.
   */
  private pushRecent(tick: number, frame: InputFrame): void {
    if (this.recent.length === 0) {
      this.recentStartTick = tick;
      this.recent.push(frame);
      return;
    }

    const offset = tick - this.recentStartTick;
    if (offset >= 0 && offset < this.recent.length) {
      this.recent[offset] = frame; // re-submit of a tick already in the window
      return;
    }
    if (offset !== this.recent.length) {
      // A genuine gap: start a fresh run rather than sending frames stamped with
      // ticks they do not belong to.
      this.recent.length = 0;
      this.recentStartTick = tick;
      this.recent.push(frame);
      return;
    }

    this.recent.push(frame);
    while (this.recent.length > this.redundancy) {
      this.recent.shift();
      this.recentStartTick += 1;
    }
  }
}

/** Neutral frame, re-exported so callers do not need two imports. */
export { EMPTY_INPUT };
