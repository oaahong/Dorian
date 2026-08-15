import { createRng, nextInt, type Rng } from '../src/sim/rng';
import type { ErrorCode } from '../src/net/protocol';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../src/net/roomCode';

/**
 * Room bookkeeping, as pure functions over an explicit registry.
 *
 * No sockets and no `Date.now()`: the clock arrives as a parameter. That is what
 * lets the whole life cycle — including the half-hour expiry — be tested in
 * milliseconds with no server running, and it keeps index.ts as a thin
 * translation from socket events to these calls.
 *
 * State lives in memory on one machine, which is the right size for room-code
 * matches between friends. It also means the process must not be autoscaled or
 * auto-stopped: see fly.toml.
 */

export { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../src/net/roomCode';
export const ROOM_TTL_MS = 30 * 60 * 1000;

const STAGES = ['freezer', 'magicForest', 'diningTable'];

export interface RoomPlayer {
  connId: string;
  characterId: string | null;
  ready: boolean;
}

export interface Room {
  code: string;
  players: [RoomPlayer | null, RoomPlayer | null];
  createdAt: number;
  phase: 'lobby' | 'playing';
}

export interface Registry {
  rooms: Map<string, Room>;
  /** Reverse index so a disconnect can find its room without a scan. */
  byConn: Map<string, string>;
  rng: Rng;
}

export type Seat = 0 | 1;

export type Result<T> = { ok: true } & T | { ok: false; error: ErrorCode };

export function createRegistry(seed: number): Registry {
  return { rooms: new Map(), byConn: new Map(), rng: createRng(seed) };
}

export function roomOf(registry: Registry, connId: string): Room | null {
  const code = registry.byConn.get(connId);
  return code ? registry.rooms.get(code) ?? null : null;
}

export function createRoom(
  registry: Registry,
  connId: string,
  nowMs: number,
): Result<{ room: Room; seat: Seat }> {
  if (registry.byConn.has(connId)) return { ok: false, error: 'already-in-room' };

  const code = allocateCode(registry);
  const room: Room = {
    code,
    players: [{ connId, characterId: null, ready: false }, null],
    createdAt: nowMs,
    phase: 'lobby',
  };
  registry.rooms.set(code, room);
  registry.byConn.set(connId, code);
  return { ok: true, room, seat: 0 };
}

export function joinRoom(
  registry: Registry,
  connId: string,
  code: string,
  _nowMs: number,
): Result<{ room: Room; seat: Seat }> {
  if (registry.byConn.has(connId)) return { ok: false, error: 'already-in-room' };

  // Players type the code by hand, so casing is not part of the identity.
  const room = registry.rooms.get(code.toUpperCase());
  if (!room) return { ok: false, error: 'room-not-found' };

  const seat: Seat | null = room.players[0] === null ? 0 : room.players[1] === null ? 1 : null;
  if (seat === null) return { ok: false, error: 'room-full' };

  room.players[seat] = { connId, characterId: null, ready: false };
  registry.byConn.set(connId, room.code);
  return { ok: true, room, seat };
}

export interface Departure {
  room: Room;
  seat: Seat;
  /** Connections still in the room afterwards, to be notified. */
  remaining: string[];
}

export function leaveRoom(registry: Registry, connId: string): Departure | null {
  const room = roomOf(registry, connId);
  if (!room) return null;

  const seat: Seat = room.players[0]?.connId === connId ? 0 : 1;
  room.players[seat] = null;
  registry.byConn.delete(connId);

  const remaining = room.players.filter((p): p is RoomPlayer => p !== null).map((p) => p.connId);
  if (remaining.length === 0) registry.rooms.delete(room.code);

  return { room, seat, remaining };
}

export function selectCharacter(
  registry: Registry,
  connId: string,
  characterId: string,
): Result<{ room: Room }> {
  const player = playerOf(registry, connId);
  if (!player) return { ok: false, error: 'not-in-room' };

  player.characterId = characterId;
  // Changing pick drops readiness, so a player cannot ready up, swap, and start a
  // match the opponent never agreed to.
  player.ready = false;
  return { ok: true, room: roomOf(registry, connId)! };
}

export function setReady(
  registry: Registry,
  connId: string,
  ready: boolean,
): Result<{ room: Room }> {
  const player = playerOf(registry, connId);
  if (!player) return { ok: false, error: 'not-in-room' };

  player.ready = ready;
  return { ok: true, room: roomOf(registry, connId)! };
}

export function isReadyToStart(room: Room): boolean {
  return room.players.every((player) => player !== null && player.characterId !== null && player.ready);
}

export interface MatchStart {
  seed: number;
  stage: string;
  p1Character: string;
  p2Character: string;
}

/**
 * Decide the values both clients must agree on.
 *
 * The seed and stage are rolled once, here, and sent to both. If the two clients
 * rolled their own they would desync on the first tick — this is the reason the
 * server exists at all beyond relaying bytes.
 */
export function startMatch(registry: Registry, room: Room): MatchStart {
  room.phase = 'playing';
  return {
    seed: nextInt(registry.rng, 1, 0x7fffffff),
    stage: STAGES[nextInt(registry.rng, 0, STAGES.length)]!,
    p1Character: room.players[0]?.characterId ?? 'collapse',
    p2Character: room.players[1]?.characterId ?? 'wizard',
  };
}

export interface ReapedRoom {
  code: string;
  connIds: string[];
}

/** Drop rooms older than the TTL. Abandoned rooms are otherwise a slow leak. */
export function reapExpired(registry: Registry, nowMs: number, ttlMs = ROOM_TTL_MS): ReapedRoom[] {
  const reaped: ReapedRoom[] = [];

  for (const [code, room] of registry.rooms) {
    if (nowMs - room.createdAt <= ttlMs) continue;

    const connIds = room.players.filter((p): p is RoomPlayer => p !== null).map((p) => p.connId);
    for (const connId of connIds) registry.byConn.delete(connId);
    registry.rooms.delete(code);
    reaped.push({ code, connIds });
  }

  return reaped;
}

function playerOf(registry: Registry, connId: string): RoomPlayer | null {
  const room = roomOf(registry, connId);
  if (!room) return null;
  return room.players.find((player) => player?.connId === connId) ?? null;
}

/**
 * Draw an unused code. The alphabet gives 31^6 combinations, so a collision is
 * already unlikely; retrying makes it impossible rather than merely improbable.
 */
function allocateCode(registry: Registry): string {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      code += ROOM_CODE_ALPHABET[nextInt(registry.rng, 0, ROOM_CODE_ALPHABET.length)];
    }
    if (!registry.rooms.has(code)) return code;
  }
  throw new Error('Could not allocate a free room code');
}
