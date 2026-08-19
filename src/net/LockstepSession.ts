import { EMPTY_INPUT, INPUT_FRAME_MASK, type InputFrame } from '../sim/input';
import type { PlayerIndex } from '../sim/types';
import { InputRing, INPUT_RING_SIZE, type Session, type SessionStatus } from './Session';
import type { ChecksumMessage, InputMessage, Transport } from './Transport';
import { MAX_INPUT_BATCH } from './protocol';

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
   * Window width used before any ack has arrived, and against a peer too old to
   * send one. Defaults to three times the input delay — see the note on the
   * field. Once the peer starts acking, the window is derived from that instead.
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
 * Smallest window once the peer is telling us what it still needs.
 *
 * The invariant the ack window is built on is that **a frame leaves the send
 * buffer only when the peer has said, in a packet we parsed, that it has it**.
 * Retention is gated on evidence rather than on age, so the deadlock the note
 * above describes — frames sliding out of the window while the peer still needs
 * them — cannot occur however narrow this is. The floor is not what prevents it.
 *
 * What the floor buys is duplicate transmissions before the peer has to ask
 * again. Four means three consecutive losses of the same frame are needed to
 * cost a round trip: about one in 125,000 at 2% loss, one in 125 at 20%, and in
 * that case the peer's next ack names the hole and the following packet fills
 * it. Scaling with the delay keeps roughly a round trip of duplicates in flight
 * where a resend is expensive.
 */
const ACK_WINDOW_FLOOR = 4;

/**
 * Retransmission pacing while stalled: 16, 16, 16, 32, 64, 64... milliseconds.
 *
 * Throttled by time and never by call count. Counting calls ties the rate to the
 * frame rate, and a stalled client only gets one call per rendered frame — on a
 * client managing 17 fps that worked out at two retransmissions a second. The
 * channel is deliberately unreliable, so a dropped message then cost half a
 * second of standing still and a match spent almost all its time waiting. That
 * is the bug this schedule must not reintroduce, which is why the first few
 * resends stay at the original 16 ms.
 *
 * After those, backing off is safe in a way it was not before. The flat rate was
 * covering for *blind* retransmission: with no idea what the peer was missing,
 * volume was the only strategy. Every resend now carries the peer's exact ack,
 * so a slower one is still a targeted one.
 *
 * The ceiling is what keeps it honest. A resend is also this client's ack
 * carrier, so backing off indefinitely would slow down telling the peer which
 * frame is missing; at 64 ms a stalled client still sends fifteen a second.
 * Together with the ack window this makes the stalled case markedly cheaper: the
 * window is at its widest exactly while stalled, and the rate falls from sixty a
 * second to fifteen.
 */
const RESEND_FAST_MS = 16;
const RESEND_FAST_COUNT = 3;
const RESEND_MAX_MS = 64;

export class LockstepSession implements Session {
  readonly localPlayer: PlayerIndex;
  readonly inputDelay: number;

  private readonly transport: Transport;
  /** Window width with no ack to go on: exactly what this class always used. */
  private readonly legacyWindow: number;
  private readonly windowFloor: number;
  private readonly now: () => number;
  private readonly local = new InputRing();
  private readonly remote = new InputRing();
  /** Frames recently sent, resent as redundancy. */
  private readonly recent: InputFrame[] = [];
  private recentStartTick = 0;

  private localChecksums = new Map<number, number>();
  private remoteChecksums = new Map<number, number>();

  /**
   * Lowest tick not yet received from the opponent — the ack this client sends.
   *
   * Kept as a cursor rather than recomputed, because `InputRing` is a ring and
   * scanning it every message would be O(size) sixty times a second. It only ever
   * moves forward, so its total travel over a match is the number of ticks
   * received: amortised O(1).
   *
   * It starts at `inputDelay` because the constructor primes `[0, inputDelay)`
   * with neutral input. Two properties worth knowing:
   *
   * - it is always greater than `consumedThrough`, since a tick can only be
   *   consumed once its remote frame exists — so the ack never understates what
   *   we have, and is *tighter* than `consumedThrough + 1`, which frees the peer
   *   from resending frames we hold but have not simulated yet;
   * - a frame rejected by the ring guard leaves the cursor parked on the hole, so
   *   we keep asking for it and the peer cannot have dropped it, because our ack
   *   never moved past it.
   */
  private remoteNextWanted: number;

  /**
   * Lowest tick the peer says it still needs from us, or null if it has never
   * said.
   *
   * Null is load-bearing rather than merely tidy. Without it, a peer that never
   * acks — an older build — would leave this at 0 forever and every packet would
   * carry the full 64-frame cap, which is four times *worse* than the fixed
   * window it replaced. Null means "fall back to exactly the old behaviour".
   */
  private peerNextWanted: number | null = null;

  /** Ceiling for ack sanitisation: a peer cannot want past what we have sent. */
  private highestSentTick = -1;

  /**
   * Whether the peer has ever sent an extension tail.
   *
   * Gates the checksum piggyback. Against a peer that ignores the tail,
   * piggybacking would silently switch desync detection off altogether, so until
   * one is seen the checksum goes out in its own packet exactly as before. In a
   * matched pair this is dead code within a few ticks: the peer's first input
   * packet arrives long before the first checksum at tick 60.
   */
  private peerSpeaksExt = false;

  /**
   * A checksum waiting for the next input packet to carry it.
   *
   * One slot, overwritten on collision. Filling it twice would take sixty
   * consecutive throttled transmits between two checksums; the cost if it ever
   * happened is one skipped comparison, with detection resuming a second later —
   * cheaper than a queue for a once-a-second field.
   */
  private pendingChecksum: ChecksumMessage | null = null;

  private currentStatus: SessionStatus = 'ok';
  private stalled = 0;
  private lastSendAtMs = 0;
  /** Consecutive retransmissions since the last sign of progress. */
  private stallResends = 0;
  private divergedAt: number | null = null;
  /** Highest tick already handed to the simulation; frames for it are now history. */
  private consumedThrough = -1;

  constructor(options: LockstepOptions) {
    this.localPlayer = options.localPlayer;
    this.inputDelay = Math.max(0, Math.floor(options.inputDelay));
    this.transport = options.transport;
    this.legacyWindow =
      options.redundancy ?? Math.max(MIN_REDUNDANCY, this.inputDelay * REDUNDANCY_PER_DELAY_TICK);
    this.windowFloor = Math.min(MIN_REDUNDANCY, Math.max(ACK_WINDOW_FLOOR, this.inputDelay + 1));
    this.now = options.now ?? (() => Date.now());
    this.remoteNextWanted = this.inputDelay;

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

    // A newly sampled tick is progress by definition, so the backoff starts over.
    this.stallResends = 0;
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
    if (this.now() - this.lastSendAtMs < this.resendIntervalMs()) return;
    this.stallResends += 1;
    this.transmit();
  }

  /** Current gap between retransmissions; see the note on the constants. */
  private resendIntervalMs(): number {
    const doublings = Math.max(0, this.stallResends - (RESEND_FAST_COUNT - 1));
    return Math.min(RESEND_MAX_MS, RESEND_FAST_MS << doublings);
  }

  private transmit(): void {
    if (this.recent.length === 0) return;
    // Sized at the last moment, so a stalled client that has been throttled for a
    // while still benefits from acks that arrived meanwhile.
    this.trimRecent();
    this.lastSendAtMs = this.now();
    this.highestSentTick = Math.max(
      this.highestSentTick,
      this.recentStartTick + this.recent.length - 1,
    );
    this.transport.sendInput({
      startTick: this.recentStartTick,
      frames: [...this.recent],
      nextWanted: this.remoteNextWanted,
      checksum: this.pendingChecksum ?? undefined,
    });
    // Cleared on send, so a retransmission does not repeat it. Losing the packet
    // loses that checksum, exactly as losing a standalone one always did.
    this.pendingChecksum = null;
  }

  /**
   * First tick the next message should carry.
   *
   * The retained set is the union of "everything the peer has not acked" and
   * "the last `windowFloor` frames", clamped to what the wire format can hold.
   * With no ack it is the old fixed window, byte for byte.
   */
  private windowStartTick(newestTick: number): number {
    if (this.peerNextWanted === null) return newestTick - (this.legacyWindow - 1);
    const floorStart = newestTick - (this.windowFloor - 1);
    const hardStart = newestTick - (MAX_INPUT_BATCH - 1);
    return Math.max(hardStart, Math.min(this.peerNextWanted, floorStart));
  }

  /**
   * Drop frames from the front of the window that no longer need repeating.
   *
   * Clamping here rather than relying on `encodeInput` matters: that truncates
   * silently at `MAX_INPUT_BATCH`, which would be real frame loss presented as a
   * successful send.
   */
  private trimRecent(): void {
    if (this.recent.length === 0) return;
    const newest = this.recentStartTick + this.recent.length - 1;
    const wanted = this.windowStartTick(newest);
    while (this.recent.length > 1 && this.recentStartTick < wanted) {
      this.recent.shift();
      this.recentStartTick += 1;
    }
  }

  /**
   * Fold in the peer's ack, defensively.
   *
   * Monotone because a peer's true contiguous position never goes backwards, so
   * a late, lower sample is an under-estimate — which only costs bandwidth, never
   * correctness. The dangerous direction is an ack that runs *ahead* of what we
   * have actually sent, which would shrink the window past frames still in
   * flight, so it is clamped.
   *
   * A peer that lies within the clamp starves only itself: it cannot alter a
   * frame's value, cannot desync us, and cannot stall the match in any way that
   * simply sending nothing would not already achieve.
   */
  private acceptPeerAck(raw: number | undefined): void {
    if (raw === undefined) return;
    if (!Number.isInteger(raw) || raw < 0 || raw > 0xffffffff) return;
    const value = Math.min(raw, this.highestSentTick + 1);
    if (this.peerNextWanted !== null && value <= this.peerNextWanted) return;
    this.peerNextWanted = value;
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

    while (this.remote.has(this.remoteNextWanted)) this.remoteNextWanted += 1;
    if (message.nextWanted !== undefined) this.peerSpeaksExt = true;
    this.acceptPeerAck(message.nextWanted);
    if (message.checksum) this.acceptRemoteChecksum(message.checksum);
  }

  /** Publish this client's world fingerprint and compare it with the opponent's. */
  recordChecksum(tick: number, hash: number): void {
    this.localChecksums.set(tick, hash >>> 0);
    if (this.peerSpeaksExt) this.pendingChecksum = { tick, hash: hash >>> 0 };
    else this.transport.sendChecksum({ tick, hash: hash >>> 0 });
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
   * The re-submit case matters more than it looks, and more under an ack window
   * than it did under a fixed one: a stalled client keeps offering the same tick
   * every frame while it waits. Treating that as a gap would reset the window to
   * a single frame — and that window is now precisely the set of frames the peer
   * has not confirmed, so resetting it would discard unacked frames permanently
   * rather than merely losing redundancy.
   *
   * The gap branch resets the run and so does discard unacked frames. It stays
   * that way because the only caller derives the tick from `world.tick`, which
   * increments by one, so a gap means the simulation skipped a tick — already a
   * desync by another route. Filling the gap with `EMPTY_INPUT` would be worse
   * still: inventing a frame the peer will treat as final is a guaranteed one.
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
    // Bounds memory during a long throttled stall; `transmit` trims again with
    // whatever acks landed in the meantime.
    this.trimRecent();
  }
}

/** Neutral frame, re-exported so callers do not need two imports. */
export { EMPTY_INPUT };
