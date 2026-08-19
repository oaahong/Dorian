import { describe, it, expect, beforeEach } from 'vitest';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../../sim/input';
import { LockstepSession } from '../LockstepSession';
import { INPUT_RING_SIZE } from '../Session';
import type { ChecksumMessage, InputMessage, Transport } from '../Transport';

/**
 * Input-delay lockstep, in isolation from any real socket.
 *
 * The contract is narrow on purpose: the session decides only whether a tick can
 * be simulated yet. Everything about how bytes reach the other machine lives
 * behind Transport, so the same session runs over a WebSocket today and a WebRTC
 * data channel later without changing a line here.
 */

class RecordingTransport implements Transport {
  readonly sentInputs: InputMessage[] = [];
  readonly sentChecksums: ChecksumMessage[] = [];
  private inputHandler: ((msg: InputMessage) => void) | null = null;
  private checksumHandler: ((msg: ChecksumMessage) => void) | null = null;

  sendInput(msg: InputMessage): void { this.sentInputs.push(msg); }
  sendChecksum(msg: ChecksumMessage): void { this.sentChecksums.push(msg); }
  onInput(handler: (msg: InputMessage) => void): void { this.inputHandler = handler; }
  onChecksum(handler: (msg: ChecksumMessage) => void): void { this.checksumHandler = handler; }

  /** Simulate a message arriving from the other player. */
  deliverInput(msg: InputMessage): void { this.inputHandler?.(msg); }
  deliverChecksum(msg: ChecksumMessage): void { this.checksumHandler?.(msg); }
}

const DELAY = 3;

describe('LockstepSession', () => {
  let transport: RecordingTransport;
  let session: LockstepSession;
  /** Retransmission is throttled by time, so the tests own the clock. */
  let clock: number;

  beforeEach(() => {
    transport = new RecordingTransport();
    clock = 0;
    session = new LockstepSession({ localPlayer: 0, inputDelay: DELAY, transport, now: () => clock });
  });

  describe('the delay window', () => {
    it('resolves the first `delay` ticks without any input at all', () => {
      // Nothing was sampled early enough to apply to them, so both seats are
      // neutral. Without this the match could never start.
      for (let tick = 0; tick < DELAY; tick += 1) {
        expect(session.inputsForTick(tick)).toEqual([EMPTY_INPUT, EMPTY_INPUT]);
      }
      expect(session.status).toBe('ok');
    });

    it('applies a locally sampled frame `delay` ticks later', () => {
      session.submitLocalInput(0, BUTTON.Right);
      session.acceptRemoteInput({ startTick: DELAY, frames: [BUTTON.Left] });
      expect(session.inputsForTick(DELAY)).toEqual([BUTTON.Right, BUTTON.Left]);
    });

    it('sends each locally sampled frame stamped with the tick it applies to', () => {
      session.submitLocalInput(0, BUTTON.Light);
      const [message] = transport.sentInputs;
      expect(message!.startTick + message!.frames.length - 1).toBe(DELAY);
      expect(message!.frames).toContain(BUTTON.Light);
    });
  });

  describe('waiting for the opponent', () => {
    it('refuses to advance while the remote frame is missing', () => {
      session.submitLocalInput(0, BUTTON.Right);
      expect(session.inputsForTick(DELAY)).toBeNull();
      expect(session.status).toBe('waiting');
    });

    it('advances as soon as the late frame arrives', () => {
      session.submitLocalInput(0, BUTTON.Right);
      expect(session.inputsForTick(DELAY)).toBeNull();

      session.acceptRemoteInput({ startTick: DELAY, frames: [BUTTON.Heavy] });

      expect(session.inputsForTick(DELAY)).toEqual([BUTTON.Right, BUTTON.Heavy]);
      expect(session.status).toBe('ok');
    });

    it('refuses to advance while the local frame is missing', () => {
      session.acceptRemoteInput({ startTick: DELAY, frames: [BUTTON.Heavy] });
      expect(session.inputsForTick(DELAY)).toBeNull();
    });
  });

  describe('seating', () => {
    it('puts the local frame in slot 0 when the local player is 0', () => {
      session.submitLocalInput(0, BUTTON.Light);
      session.acceptRemoteInput({ startTick: DELAY, frames: [BUTTON.Heavy] });
      expect(session.inputsForTick(DELAY)).toEqual([BUTTON.Light, BUTTON.Heavy]);
    });

    it('puts the local frame in slot 1 when the local player is 1', () => {
      // The guest's own presses must land on player two, or both clients would
      // simulate the same fighter.
      const guest = new LockstepSession({ localPlayer: 1, inputDelay: DELAY, transport });
      guest.submitLocalInput(0, BUTTON.Light);
      guest.acceptRemoteInput({ startTick: DELAY, frames: [BUTTON.Heavy] });
      expect(guest.inputsForTick(DELAY)).toEqual([BUTTON.Heavy, BUTTON.Light]);
    });
  });

  describe('message handling', () => {
    it('accepts a batch covering several ticks', () => {
      // Messages carry a run of recent frames so a single lost packet heals
      // itself on the next one.
      session.acceptRemoteInput({ startTick: DELAY, frames: [BUTTON.Left, BUTTON.Right, BUTTON.Up] });
      for (let i = 0; i < 3; i += 1) session.submitLocalInput(i, EMPTY_INPUT);

      expect(session.inputsForTick(DELAY)?.[1]).toBe(BUTTON.Left);
      expect(session.inputsForTick(DELAY + 1)?.[1]).toBe(BUTTON.Right);
      expect(session.inputsForTick(DELAY + 2)?.[1]).toBe(BUTTON.Up);
    });

    it('is idempotent when the same frame arrives twice', () => {
      session.submitLocalInput(0, EMPTY_INPUT);
      session.acceptRemoteInput({ startTick: DELAY, frames: [BUTTON.Light] });
      session.acceptRemoteInput({ startTick: DELAY, frames: [BUTTON.Light] });
      expect(session.inputsForTick(DELAY)).toEqual([EMPTY_INPUT, BUTTON.Light]);
    });

    it('ignores a frame for a tick that has already been simulated', () => {
      session.submitLocalInput(0, EMPTY_INPUT);
      session.acceptRemoteInput({ startTick: DELAY, frames: [BUTTON.Light] });
      session.inputsForTick(DELAY);

      // A duplicate arriving late must not rewrite history.
      session.acceptRemoteInput({ startTick: DELAY, frames: [BUTTON.Heavy] });
      expect(session.inputsForTick(DELAY)).toEqual([EMPTY_INPUT, BUTTON.Light]);
    });

    it('drops a frame too far in the future to store', () => {
      // Beyond the ring buffer it would wrap around and corrupt a live tick.
      session.acceptRemoteInput({ startTick: INPUT_RING_SIZE * 4, frames: [BUTTON.Light] });
      session.submitLocalInput(0, EMPTY_INPUT);
      expect(session.inputsForTick(DELAY)).toBeNull();
    });

    it('rejects a malformed message without throwing', () => {
      expect(() => session.acceptRemoteInput({ startTick: -5, frames: [] })).not.toThrow();
      expect(() => session.acceptRemoteInput({ startTick: 0, frames: [999] })).not.toThrow();
    });

    it('masks a frame carrying undefined bits', () => {
      session.submitLocalInput(0, EMPTY_INPUT);
      session.acceptRemoteInput({ startTick: DELAY, frames: [0xffff] });
      expect(session.inputsForTick(DELAY)?.[1]).toBe(0x1ff);
    });
  });

  describe('ring buffer', () => {
    it('survives running far past its own size', () => {
      const ticks = INPUT_RING_SIZE * 3;
      for (let tick = 0; tick < ticks; tick += 1) {
        session.submitLocalInput(tick, tick % 2 === 0 ? BUTTON.Left : BUTTON.Right);
        session.acceptRemoteInput({ startTick: tick + DELAY, frames: [BUTTON.Up] });
        const inputs = session.inputsForTick(tick);
        expect(inputs, `tick ${tick}`).not.toBeNull();
      }
      expect(session.status).toBe('ok');
    });
  });

  describe('desync detection', () => {
    it('stays healthy while the checksums agree', () => {
      session.recordChecksum(60, 0xabcdef);
      session.acceptRemoteChecksum({ tick: 60, hash: 0xabcdef });
      expect(session.status).toBe('ok');
    });

    it('reports a desync when they disagree', () => {
      session.recordChecksum(60, 0xabcdef);
      session.acceptRemoteChecksum({ tick: 60, hash: 0x123456 });
      expect(session.status).toBe('desync');
      expect(session.desyncTick).toBe(60);
    });

    it('publishes the local checksum for the other client to compare', () => {
      session.recordChecksum(60, 0xabcdef);
      expect(transport.sentChecksums).toContainEqual({ tick: 60, hash: 0xabcdef });
    });

    it('holds a remote checksum until the local one for that tick exists', () => {
      // The two clients do not run in lockstep with each other in wall-clock
      // terms, so the remote hash routinely arrives first.
      session.acceptRemoteChecksum({ tick: 60, hash: 0x123456 });
      expect(session.status).toBe('ok');

      session.recordChecksum(60, 0xabcdef);
      expect(session.status).toBe('desync');
    });

    it('does not un-desync once it has diverged', () => {
      session.recordChecksum(60, 1);
      session.acceptRemoteChecksum({ tick: 60, hash: 2 });
      session.recordChecksum(120, 3);
      session.acceptRemoteChecksum({ tick: 120, hash: 3 });
      expect(session.status).toBe('desync');
    });
  });

  describe('disconnection', () => {
    it('reports a disconnect and stops advancing', () => {
      session.submitLocalInput(0, EMPTY_INPUT);
      session.acceptRemoteInput({ startTick: DELAY, frames: [EMPTY_INPUT] });
      session.disconnect();
      expect(session.status).toBe('disconnected');
      expect(session.inputsForTick(DELAY)).toBeNull();
    });
  });

  describe('a frame that has been sent is final', () => {
    /**
     * The opponent keeps the first value it receives for a tick and ignores any
     * later one, so changing our mind after transmitting means the two clients
     * simulate that tick from different inputs. That is a desync, and it is
     * reachable from ordinary play: a stalled client keeps being asked for its
     * current buttons, and a player mashing during the stall produces a different
     * answer each time.
     */
    it('keeps the first frame offered for a tick', () => {
      session.submitLocalInput(0, BUTTON.Light);
      session.submitLocalInput(0, BUTTON.Heavy);

      session.acceptRemoteInput({ startTick: DELAY, frames: [EMPTY_INPUT] });
      expect(session.inputsForTick(DELAY)).toEqual([BUTTON.Light, EMPTY_INPUT]);
    });

    it('never transmits a second, different value for the same tick', () => {
      session.submitLocalInput(0, BUTTON.Light);
      session.submitLocalInput(0, BUTTON.Heavy);
      session.submitLocalInput(0, BUTTON.Right);

      const framesSent = transport.sentInputs.flatMap((message) =>
        message.frames.map((frame, i) => ({ tick: message.startTick + i, frame })),
      );
      const forDelayTick = new Set(framesSent.filter((f) => f.tick === DELAY).map((f) => f.frame));
      expect([...forDelayTick]).toEqual([BUTTON.Light]);
    });

    it('still lets a later tick carry a new value', () => {
      session.submitLocalInput(0, BUTTON.Light);
      session.submitLocalInput(1, BUTTON.Heavy);

      session.acceptRemoteInput({ startTick: DELAY, frames: [EMPTY_INPUT, EMPTY_INPUT] });
      expect(session.inputsForTick(DELAY)?.[0]).toBe(BUTTON.Light);
      expect(session.inputsForTick(DELAY + 1)?.[0]).toBe(BUTTON.Heavy);
    });
  });

  describe('send throttling', () => {
    it('sends once per newly sampled tick', () => {
      for (let tick = 0; tick < 5; tick += 1) session.submitLocalInput(tick, BUTTON.Right);
      expect(transport.sentInputs).toHaveLength(5);
    });

    it('does not resend on every re-offer of the same tick', () => {
      /**
       * A stalled client re-offers its current tick every frame. Sending each time
       * is 60 messages a second saying nothing new, which is enough to trip the
       * server's flood protection when a client is catching up.
       */
      session.submitLocalInput(0, BUTTON.Right);
      const afterFirst = transport.sentInputs.length;

      for (let i = 0; i < 6; i += 1) session.submitLocalInput(0, BUTTON.Right);
      expect(transport.sentInputs).toHaveLength(afterFirst);
    });

    it('keeps the first few resends fast, then backs off to a floor', () => {
      /**
       * Going fully silent would deadlock both clients if the message carrying
       * that frame was the one that got dropped, so the schedule backs off to a
       * rate and never to zero. The early resends stay at the original 16 ms
       * because the bug this class had before was resending too *slowly*.
       */
      session.submitLocalInput(0, BUTTON.Right);
      const sentAt: number[] = [];
      const before = transport.sentInputs.length;

      for (let i = 0; i < 400; i += 1) {
        clock += 4;
        const was = transport.sentInputs.length;
        session.resend();
        if (transport.sentInputs.length > was) sentAt.push(clock);
      }

      expect(transport.sentInputs.length).toBeGreaterThan(before);
      const gaps = sentAt.slice(1).map((at, i) => at - sentAt[i]!);
      // 16, 16, 32, 64, 64... measured in 4 ms steps, so each lands on a multiple.
      expect(gaps.slice(0, 2)).toEqual([16, 16]);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(64);
      // Fifteen a second at the floor is still far above the two a second that
      // made a dropped packet cost half a second of standing still.
      expect(sentAt.length).toBeGreaterThan(20);
    });

    it('starts the backoff over once the caller makes progress', () => {
      // The backoff must not leak into a healthy stretch: a newly sampled tick
      // means the stall is over.
      session.submitLocalInput(0, BUTTON.Right);
      for (let i = 0; i < 20; i += 1) { clock += 100; session.resend(); }

      session.submitLocalInput(1, BUTTON.Left);
      const afterProgress = transport.sentInputs.length;
      clock += 16;
      session.resend();
      expect(transport.sentInputs.length).toBe(afterProgress + 1);
    });

    it('does not resend faster than the throttle allows', () => {
      // The rate has to be bounded by time, not by how often the caller asks:
      // a stalled client asks once per rendered frame, which ties the recovery
      // rate to the frame rate and collapses on a struggling machine.
      session.submitLocalInput(0, BUTTON.Right);
      const afterFirst = transport.sentInputs.length;

      for (let i = 0; i < 100; i += 1) session.resend();
      expect(transport.sentInputs.length).toBe(afterFirst);

      clock += 20;
      session.resend();
      expect(transport.sentInputs.length).toBe(afterFirst + 1);
    });

    it('treats a re-offer of a settled tick as a resend opportunity', () => {
      // The value cannot change, but the caller repeating itself is still the
      // signal that it is stalled and the opponent may be missing something.
      session.submitLocalInput(0, BUTTON.Right);
      const afterFirst = transport.sentInputs.length;

      for (let i = 0; i < 40; i += 1) {
        clock += 20;
        session.submitLocalInput(0, BUTTON.Left);
      }
      expect(transport.sentInputs.length).toBeGreaterThan(afterFirst);
    });
  });

  describe('the ack window', () => {
    /**
     * The window used to be a fixed `max(12, 3 * delay)` frames, repeated whether
     * or not the opponent already had them. It is now derived from what the peer
     * says it still needs, with a floor. The invariant underneath every test here
     * is that a frame leaves the send buffer only once the peer has said, in a
     * packet we parsed, that it has it.
     */
    const last = () => transport.sentInputs[transport.sentInputs.length - 1]!;
    const advance = (through: number) => {
      for (let tick = 0; tick <= through; tick += 1) session.submitLocalInput(tick, BUTTON.Right);
    };

    it('advertises the first tick it still needs, counting the primed opening', () => {
      session.submitLocalInput(0, BUTTON.Right);
      expect(last().nextWanted).toBe(DELAY);
    });

    it('advances the ack only across a contiguous run', () => {
      // A hole keeps the ack parked on it, which is what makes the peer resend
      // exactly that frame and nothing else.
      transport.deliverInput({ startTick: DELAY, frames: [1, 1] });
      transport.deliverInput({ startTick: DELAY + 3, frames: [1] });
      session.submitLocalInput(0, BUTTON.Right);
      expect(last().nextWanted).toBe(DELAY + 2);

      transport.deliverInput({ startTick: DELAY + 2, frames: [1] });
      session.submitLocalInput(1, BUTTON.Right);
      expect(last().nextWanted).toBe(DELAY + 4);
    });

    it('keeps the old fixed window until the peer acks at all', () => {
      // Byte for byte what this class always sent, which is what makes an older
      // peer — or a peer whose packets are all being lost — no worse off.
      advance(40);
      expect(last().frames).toHaveLength(Math.max(12, DELAY * 3));
    });

    it('shrinks to the floor once the peer acks', () => {
      advance(40);
      const newest = last().startTick + last().frames.length - 1;
      transport.deliverInput({ startTick: DELAY, frames: [1], nextWanted: newest });
      session.submitLocalInput(41, BUTTON.Left);
      expect(last().frames.length).toBeLessThan(Math.max(12, DELAY * 3));
    });

    it('never drops a frame the peer has not acked', () => {
      /**
       * The whole point of the change: retention is gated on evidence of receipt
       * rather than on age. The ack has to arrive while the frames are still held
       * — before any ack, the window is trimmed by the legacy width exactly as it
       * always was, and a later ack cannot resurrect what that already discarded.
       * That bound is inherited from the old behaviour, not introduced here.
       */
      advance(10);
      transport.deliverInput({ startTick: DELAY, frames: [1], nextWanted: 5 });
      for (let tick = 11; tick <= 40; tick += 1) session.submitLocalInput(tick, BUTTON.Right);
      expect(last().startTick).toBeLessThanOrEqual(5);
    });

    it('ignores an ack that arrives out of order and would widen nothing', () => {
      // Acks are cumulative, so a late lower one is a stale under-estimate. Taking
      // the max is correct; regressing on it would only cost bandwidth, but
      // pretending it moved forward would drop frames still in flight.
      advance(40);
      const newest = last().startTick + last().frames.length - 1;
      transport.deliverInput({ startTick: DELAY, frames: [1], nextWanted: newest });
      session.submitLocalInput(41, BUTTON.Left);
      const tight = last().startTick;

      transport.deliverInput({ startTick: DELAY, frames: [1], nextWanted: 5 });
      session.submitLocalInput(42, BUTTON.Left);
      expect(last().startTick).toBeGreaterThanOrEqual(tight);
    });

    it('clamps an ack that runs ahead of anything it could have received', () => {
      // The dangerous direction, and the one a hostile peer would pick: it
      // shrinks the window past frames still in flight.
      advance(20);
      transport.deliverInput({ startTick: DELAY, frames: [1], nextWanted: 10_000_000 });
      session.submitLocalInput(21, BUTTON.Left);
      const newest = last().startTick + last().frames.length - 1;
      expect(last().startTick).toBeLessThanOrEqual(newest);
      expect(last().frames.length).toBeGreaterThan(0);
    });

    it.each([
      ['not an integer', 12.5],
      ['negative', -1],
      ['beyond a u32', 0x1_0000_0000],
      ['NaN', Number.NaN],
    ])('ignores an ack that is %s', (_name, nextWanted) => {
      advance(20);
      const before = last().startTick;
      expect(() =>
        transport.deliverInput({ startTick: DELAY, frames: [1], nextWanted }),
      ).not.toThrow();
      session.submitLocalInput(21, BUTTON.Left);
      expect(last().startTick).toBeLessThanOrEqual(before + 1);
    });

    it('never exceeds what the wire format can carry', () => {
      // `encodeInput` truncates silently at MAX_INPUT_BATCH, so a window wider
      // than that is frame loss dressed up as a successful send.
      for (let tick = 0; tick <= 400; tick += 1) {
        session.submitLocalInput(tick, BUTTON.Right);
        transport.deliverInput({ startTick: DELAY, frames: [1], nextWanted: 0 });
      }
      for (const message of transport.sentInputs) {
        expect(message.frames.length).toBeLessThanOrEqual(64);
      }
    });
  });

  describe('the piggybacked checksum', () => {
    it('sends its own packet until the peer proves it understands the tail', () => {
      // Against an older peer, piggybacking would switch desync detection off
      // without saying so.
      session.recordChecksum(60, 0xabcdef);
      expect(transport.sentChecksums).toHaveLength(1);
    });

    it('rides along on the next input packet once the peer has acked', () => {
      transport.deliverInput({ startTick: DELAY, frames: [1], nextWanted: DELAY });
      session.recordChecksum(60, 0xabcdef);
      expect(transport.sentChecksums).toHaveLength(0);

      session.submitLocalInput(0, BUTTON.Right);
      expect(transport.sentInputs[transport.sentInputs.length - 1]!.checksum)
        .toEqual({ tick: 60, hash: 0xabcdef });
    });

    it('carries it once, not on every retransmission', () => {
      transport.deliverInput({ startTick: DELAY, frames: [1], nextWanted: DELAY });
      session.recordChecksum(60, 1);
      session.submitLocalInput(0, BUTTON.Right);
      clock += 200;
      session.resend();
      expect(transport.sentInputs[transport.sentInputs.length - 1]!.checksum).toBeUndefined();
    });
  });

  describe('stall reporting', () => {
    it('tracks how long it has been waiting so the view can say so', () => {
      session.submitLocalInput(0, BUTTON.Right);
      expect(session.stalledTicks).toBe(0);

      session.inputsForTick(DELAY);
      session.inputsForTick(DELAY);
      session.inputsForTick(DELAY);
      expect(session.stalledTicks).toBe(3);

      session.acceptRemoteInput({ startTick: DELAY, frames: [EMPTY_INPUT] });
      session.inputsForTick(DELAY);
      expect(session.stalledTicks).toBe(0);
    });
  });
});
