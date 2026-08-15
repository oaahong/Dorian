import {
  decodeBinary,
  decodeServerMessage,
  encodeChecksum,
  encodeInput,
  encodeJson,
  type ClientMessage,
  type RoomSlot,
  type ServerMessage,
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

  /** Open a connection to the server this page was served from. */
  static url(): string {
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
   * Input delay in ticks, derived from the measured round trip.
   *
   * A frame has to reach the other player before the tick it applies to, and
   * traffic is relayed rather than sent peer to peer — so the path is
   * `me -> server -> them`, not `me -> them`. For two players with similar
   * latency to the server that path costs about a full round trip to the server,
   * which is what `roundTripMs` measures. Treating it as half a round trip, as if
   * the connection were direct, undersizes the delay by roughly two and shows up
   * as avoidable stalls.
   *
   * One extra tick covers jitter. Clamped so the delay never becomes unplayable
   * or pointlessly tight.
   */
  suggestedInputDelay(min = 2, max = 6): number {
    if (this.roundTripMs === null) return min + 1;
    const relayTicks = Math.ceil(this.roundTripMs / (1000 / 60));
    return Math.min(max, Math.max(min, relayTicks + 1));
  }

  createRoom(): void { this.sendMessage({ t: 'createRoom' }); }
  joinRoom(code: string): void { this.sendMessage({ t: 'joinRoom', code }); }
  selectCharacter(characterId: string): void { this.sendMessage({ t: 'selectCharacter', characterId }); }
  setReady(ready: boolean): void { this.sendMessage({ t: 'ready', ready }); }
  leave(): void { this.sendMessage({ t: 'leave' }); }

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
