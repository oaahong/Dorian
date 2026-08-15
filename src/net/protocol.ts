import { INPUT_FRAME_MASK, type InputFrame } from '../sim/input';
import type { PlayerIndex } from '../sim/types';

/**
 * The wire protocol, shared by the client and the server.
 *
 * Two encodings on one socket, chosen by traffic shape:
 *
 * - Lobby traffic is JSON. It is rare, human-readable in a network inspector, and
 *   its shape changes as features are added.
 * - Input and checksum traffic is binary. It runs 60 times a second for the whole
 *   match, and a frame really is one byte — wrapping that in JSON would multiply
 *   the bandwidth by roughly thirty for no benefit.
 */

// --- Lobby (JSON) -----------------------------------------------------------

export interface RoomSlot {
  characterId: string | null;
  ready: boolean;
}

/**
 * A WebRTC negotiation payload, passed through the server untouched.
 *
 * The server does not parse or care what is inside; it is an opaque blob that one
 * client needs the other to see. Keeping it opaque means the signalling code can
 * change without touching the server.
 */
export interface SignalPayload {
  /**
   * `transport` is the host's verdict on which connection the match will use.
   * It travels over the relay, which is always available, so both clients agree
   * even when the peer connection is still settling.
   */
  kind: 'offer' | 'answer' | 'candidate' | 'transport';
  data: string;
}

export type ClientMessage =
  | { t: 'createRoom' }
  | { t: 'signal'; payload: SignalPayload }
  | { t: 'joinRoom'; code: string }
  | { t: 'selectCharacter'; characterId: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'ping'; id: number }
  | { t: 'leave' };

export type ServerMessage =
  | { t: 'roomState'; code: string; seat: PlayerIndex; slots: [RoomSlot | null, RoomSlot | null] }
  | {
      t: 'matchStart';
      seed: number;
      stage: string;
      p1Character: string;
      p2Character: string;
      inputDelay: number;
    }
  | { t: 'opponentLeft' }
  | { t: 'signal'; payload: SignalPayload }
  | { t: 'pong'; id: number }
  | { t: 'error'; code: ErrorCode; message: string };

export type ErrorCode =
  | 'room-not-found'
  | 'room-full'
  | 'already-in-room'
  | 'not-in-room'
  | 'bad-message'
  | 'rate-limited';

/** Largest lobby message accepted, to bound what a peer can make the server parse. */
export const MAX_JSON_BYTES = 16 * 1024;

/** Session descriptions run to a few kilobytes; candidates are far smaller. */
export const MAX_SIGNAL_BYTES = 12 * 1024;

export function encodeJson(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

/**
 * Parse a lobby message, returning null rather than throwing.
 *
 * Everything arriving here is written by someone else's process, so the shape is
 * checked rather than assumed — a malformed frame must not be able to take the
 * server down for everyone else in every other room.
 */
export function decodeClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_JSON_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const message = parsed as Record<string, unknown>;
  switch (message.t) {
    case 'createRoom':
    case 'leave':
      return { t: message.t };
    case 'joinRoom':
      return typeof message.code === 'string' && message.code.length <= 16
        ? { t: 'joinRoom', code: message.code }
        : null;
    case 'selectCharacter':
      return typeof message.characterId === 'string' && message.characterId.length <= 32
        ? { t: 'selectCharacter', characterId: message.characterId }
        : null;
    case 'ready':
      return typeof message.ready === 'boolean' ? { t: 'ready', ready: message.ready } : null;
    case 'signal': {
      const payload = message.payload as Record<string, unknown> | undefined;
      if (!payload || typeof payload.data !== 'string') return null;
      const kinds = ['offer', 'answer', 'candidate', 'transport'];
      if (typeof payload.kind !== 'string' || !kinds.includes(payload.kind)) return null;
      // Bounded so one peer cannot make the server hold an arbitrary string for
      // the other; real SDP is a couple of kilobytes at most.
      if (payload.data.length > MAX_SIGNAL_BYTES) return null;
      return { t: 'signal', payload: { kind: payload.kind as SignalPayload['kind'], data: payload.data } };
    }
    case 'ping':
      return Number.isFinite(message.id) ? { t: 'ping', id: message.id as number } : null;
    default:
      return null;
  }
}

export function decodeServerMessage(raw: string): ServerMessage | null {
  try {
    const parsed = JSON.parse(raw) as ServerMessage;
    return typeof parsed === 'object' && parsed !== null && typeof parsed.t === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

// --- Gameplay (binary) ------------------------------------------------------

const KIND_INPUT = 1;
const KIND_CHECKSUM = 2;

/** A run of input frames longer than this is nonsense and is rejected. */
export const MAX_INPUT_BATCH = 64;

export interface InputPacket {
  startTick: number;
  frames: InputFrame[];
}

export interface ChecksumPacket {
  tick: number;
  hash: number;
}

/** `[kind:u8][startTick:u32][count:u8][frames:u8...]` — six bytes plus the run. */
export function encodeInput(packet: InputPacket): Uint8Array {
  const count = Math.min(packet.frames.length, MAX_INPUT_BATCH);
  const bytes = new Uint8Array(6 + count);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, KIND_INPUT);
  view.setUint32(1, packet.startTick, true);
  view.setUint8(5, count);
  for (let i = 0; i < count; i += 1) {
    bytes[6 + i] = packet.frames[i]! & INPUT_FRAME_MASK;
  }
  return bytes;
}

/** `[kind:u8][tick:u32][hash:u32]`. */
export function encodeChecksum(packet: ChecksumPacket): Uint8Array {
  const bytes = new Uint8Array(9);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, KIND_CHECKSUM);
  view.setUint32(1, packet.tick, true);
  view.setUint32(5, packet.hash >>> 0, true);
  return bytes;
}

export type BinaryPacket =
  | ({ kind: 'input' } & InputPacket)
  | ({ kind: 'checksum' } & ChecksumPacket);

/** Decode a binary frame, returning null for anything malformed. */
export function decodeBinary(data: ArrayBufferView | ArrayBuffer): BinaryPacket | null {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.length < 1) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (view.getUint8(0)) {
    case KIND_INPUT: {
      if (bytes.length < 6) return null;
      const count = view.getUint8(5);
      if (count > MAX_INPUT_BATCH) return null;
      if (bytes.length < 6 + count) return null;
      const frames: InputFrame[] = [];
      for (let i = 0; i < count; i += 1) frames.push(bytes[6 + i]! & INPUT_FRAME_MASK);
      return { kind: 'input', startTick: view.getUint32(1, true), frames };
    }
    case KIND_CHECKSUM: {
      if (bytes.length < 9) return null;
      return { kind: 'checksum', tick: view.getUint32(1, true), hash: view.getUint32(5, true) };
    }
    default:
      return null;
  }
}
