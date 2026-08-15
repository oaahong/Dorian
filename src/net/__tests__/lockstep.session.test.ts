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

  beforeEach(() => {
    transport = new RecordingTransport();
    session = new LockstepSession({ localPlayer: 0, inputDelay: DELAY, transport });
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
      session.acceptRemoteInput({ startTick: DELAY, frames: [0xff] });
      expect(session.inputsForTick(DELAY)?.[1]).toBe(0x7f);
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

    it('still resends periodically, so a lost message can be recovered', () => {
      // Going fully silent would deadlock both clients if the message carrying
      // that frame was the one that got dropped.
      session.submitLocalInput(0, BUTTON.Right);
      const afterFirst = transport.sentInputs.length;

      for (let i = 0; i < 40; i += 1) session.submitLocalInput(0, BUTTON.Right);
      expect(transport.sentInputs.length).toBeGreaterThan(afterFirst);
    });

    it('sends immediately when the frame for a tick changes', () => {
      session.submitLocalInput(0, BUTTON.Right);
      const afterFirst = transport.sentInputs.length;
      session.submitLocalInput(0, BUTTON.Left);
      expect(transport.sentInputs.length).toBe(afterFirst + 1);
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
