import {
  decodeBinary,
  decodeServerMessage,
  encodeChecksum,
  encodeInput,
  encodeJson,
  type ClientMessage,
  type RoomSlot,
  type ServerMessage,
  type SignalPayload,
} from './protocol';
import type { ChecksumMessage, InputMessage, Transport } from './Transport';
import type { PlayerIndex } from '../sim/types';

/**
 * The client half of the connection: one socket carrying both lobby traffic and
 * gameplay traffic.
 *
 * It exposes a {@link Transport} for LockstepSession to use, so the session
 * itself stays unaware of sockets, JSON and reconnection. Everything above the
 * transport is lobby state that the scene renders.
 */

export interface RoomState {
  code: string;
  seat: PlayerIndex;
  slots: [RoomSlot | null, RoomSlot | null];
}

export interface MatchStart {
  seed: number;
  stage: string;
  p1Character: string;
  p2Character: string;
  inputDelay: number;
}

export interface OnlineClientEvents {
  onRoomState?(state: RoomState): void;
  onMatchStart?(start: MatchStart): void;
  onOpponentLeft?(): void;
  onSignal?(payload: SignalPayload): void;
  onError?(code: string, message: string): void;
  onClose?(): void;
}

/**
 * Minimal shape of a WebSocket, so this works against the browser's, Node's and a
 * fake in tests.
 *
 * `addEventListener` is typed loosely on purpose: the DOM declaration is a set of
 * overloads keyed by event name, and no single narrower signature is assignable
 * from all three implementations.
 */
export interface SocketLike {
  readyState: number;
  binaryType: string;
  send(data: string | ArrayBufferView | ArrayBuffer): void;
  close(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, handler: (event: any) => void): void;
}

const OPEN = 1;
const PING_INTERVAL_MS = 2000;
/** Smoothing on the round-trip estimate, so one slow reply does not swing it. */
const RTT_SMOOTHING = 0.25;

export class OnlineClient implements Transport {
  private inputHandler: ((message: InputMessage) => void) | null = null;
  private checksumHandler: ((message: ChecksumMessage) => void) | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pingSentAt = new Map<number, number>();
  private nextPingId = 1;

  /** Smoothed round-trip time in milliseconds, or null until the first pong. */
  roundTripMs: number | null = null;
  room: RoomState | null = null;

  constructor(
    private readonly socket: SocketLike,
    private readonly events: OnlineClientEvents = {},
    private readonly now: () => number = () => Date.now(),
  ) {
    this.socket.binaryType = 'arraybuffer';
    this.socket.addEventListener('message', (event: { data: unknown }) => this.receive(event.data));
    this.socket.addEventListener('close', () => {
      this.stopPinging();
      this.events.onClose?.();
    });
  }

  /**
   * Where to reach the signalling server.
   *
   * Defaults to the origin the page came from, which is the single-process
   * deployment. Set `VITE_WS_URL` at build time to point somewhere else — that is
   * what lets the client be served from a CDN close to the players while the
   * server lives wherever is cheapest, which matters here because the card art is
   * several megabytes and the server is only needed for a few seconds per match.
   */
  static url(): string {
    const configured = import.meta.env?.VITE_WS_URL;
    if (typeof configured === 'string' && configured.length > 0) return configured;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
  }

  startPinging(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      const id = this.nextPingId++;
      this.pingSentAt.set(id, this.now());
      this.sendMessage({ t: 'ping', id });
    }, PING_INTERVAL_MS);
  }

  stopPinging(): void {
    if (!this.pingTimer) return;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /**
   * Input delay in ticks, sized for the whole path a frame travels.
   *
   * Lockstep advances at most `inputDelay` ticks per round trip, so the delay has
   * to cover the *end-to-end* time between one client sampling a button and the
   * other having that frame in hand. Three things contribute:
   *
   * - the network hop, which for a relayed match is about a full round trip to
   *   the server (`me -> server -> them`), and much less when the two are direct;
   * - this client's frame interval, because an arriving message is not acted on
   *   until the next rendered frame;
   * - the opponent's frame interval, for the same reason.
   *
   * The frame-rate terms are easy to forget and can dominate. Measured with two
   * browsers sharing one machine at 18 fps, they added 110 ms — more than a
   * transatlantic round trip — while the delay was sized at 50 ms from the
   * network alone. The result was three ticks of progress per second-long round
   * trip, which reads as a frozen game rather than a laggy one.
   *
   * `frameIntervalMs` is the caller's measured frame time; the fallback assumes a
   * healthy 60 Hz.
   */
  suggestedInputDelay(options: {
    direct?: boolean;
    frameIntervalMs?: number;
    min?: number;
    max?: number;
  } = {}): number {
    const { direct = false, frameIntervalMs = 1000 / 60, min = 2, max = 12 } = options;

    // A direct link is not the relayed path, but it is not free either; without a
    // peer-to-peer measurement, a quarter of the server round trip is a
    // conservative stand-in.
    const networkMs = this.roundTripMs === null ? 50 : direct ? this.roundTripMs / 4 : this.roundTripMs;
    // Both ends wait for their next frame before acting on what arrived.
    const renderMs = 2 * Math.max(1000 / 60, frameIntervalMs);

    const ticks = Math.ceil((networkMs + renderMs) / (1000 / 60));
    return Math.min(max, Math.max(min, ticks + 1));
  }

  createRoom(): void { this.sendMessage({ t: 'createRoom' }); }
  joinRoom(code: string): void { this.sendMessage({ t: 'joinRoom', code }); }
  selectCharacter(characterId: string): void { this.sendMessage({ t: 'selectCharacter', characterId }); }
  setReady(ready: boolean): void { this.sendMessage({ t: 'ready', ready }); }
  leave(): void { this.sendMessage({ t: 'leave' }); }
  /** Pass a WebRTC negotiation blob to the other player, via the server. */
  sendSignal(payload: SignalPayload): void { this.sendMessage({ t: 'signal', payload }); }

  close(): void {
    this.stopPinging();
    this.socket.close();
  }

  // --- Transport ------------------------------------------------------------

  sendInput(message: InputMessage): void {
    this.sendBinary(encodeInput(message));
  }

  sendChecksum(message: ChecksumMessage): void {
    this.sendBinary(encodeChecksum(message));
  }

  onInput(handler: (message: InputMessage) => void): void {
    this.inputHandler = handler;
  }

  onChecksum(handler: (message: ChecksumMessage) => void): void {
    this.checksumHandler = handler;
  }

  // --- Internals ------------------------------------------------------------

  private receive(data: unknown): void {
    if (typeof data === 'string') {
      const message = decodeServerMessage(data);
      if (message) this.handleServerMessage(message);
      return;
    }
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      const packet = decodeBinary(data as ArrayBuffer);
      if (!packet) return;
      if (packet.kind === 'input') {
        this.inputHandler?.({ startTick: packet.startTick, frames: packet.frames });
      } else {
        this.checksumHandler?.({ tick: packet.tick, hash: packet.hash });
      }
    }
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'roomState':
        this.room = { code: message.code, seat: message.seat, slots: message.slots };
        this.events.onRoomState?.(this.room);
        return;
      case 'matchStart':
        this.events.onMatchStart?.({
          seed: message.seed,
          stage: message.stage,
          p1Character: message.p1Character,
          p2Character: message.p2Character,
          inputDelay: message.inputDelay,
        });
        return;
      case 'opponentLeft':
        this.events.onOpponentLeft?.();
        return;
      case 'signal':
        this.events.onSignal?.(message.payload);
        return;
      case 'pong': {
        const sentAt = this.pingSentAt.get(message.id);
        this.pingSentAt.delete(message.id);
        if (sentAt === undefined) return;
        const sample = this.now() - sentAt;
        this.roundTripMs =
          this.roundTripMs === null
            ? sample
            : this.roundTripMs + (sample - this.roundTripMs) * RTT_SMOOTHING;
        return;
      }
      case 'error':
        this.events.onError?.(message.code, message.message);
        return;
    }
  }

  private sendMessage(message: ClientMessage): void {
    if (this.socket.readyState !== OPEN) return;
    this.socket.send(encodeJson(message));
  }

  private sendBinary(bytes: Uint8Array): void {
    if (this.socket.readyState !== OPEN) return;
    this.socket.send(bytes);
  }
}
