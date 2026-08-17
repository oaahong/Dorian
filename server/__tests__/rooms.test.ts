import { describe, it, expect, beforeEach } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_TTL_MS,
  createRegistry,
  createRoom,
  isReadyToStart,
  joinRoom,
  leaveRoom,
  reapExpired,
  roomOf,
  selectCharacter,
  setReady,
  startMatch,
  type Registry,
} from '../rooms';

/**
 * Room bookkeeping as pure functions over an explicit registry, with the clock
 * passed in.
 *
 * Keeping it socket-free is what makes it testable at all: a room's whole life
 * cycle — including the half-hour expiry — is exercised here in milliseconds,
 * with no server to start and nothing to wait for.
 */

const NOW = 1_700_000_000_000;

describe('room codes', () => {
  it('avoids characters that are easy to misread aloud', () => {
    // Codes get read over voice chat, so 0/O and 1/I/L are excluded.
    for (const banned of ['0', 'O', '1', 'I', 'L']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(banned);
    }
    expect(ROOM_CODE_ALPHABET.length).toBeGreaterThan(20);
  });

  it('issues codes of the advertised length from that alphabet', () => {
    const registry = createRegistry(7);
    for (let i = 0; i < 50; i += 1) {
      const result = createRoom(registry, `conn-${i}`, NOW);
      expect(result.ok).toBe(true);
      const code = result.ok ? result.room.code : '';
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const char of code) expect(ROOM_CODE_ALPHABET).toContain(char);
    }
  });

  it('never issues the same code to two live rooms', () => {
    const registry = createRegistry(11);
    const codes = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      const result = createRoom(registry, `conn-${i}`, NOW);
      if (!result.ok) continue;
      expect(codes.has(result.room.code), `duplicate ${result.room.code}`).toBe(false);
      codes.add(result.room.code);
    }
    expect(codes.size).toBe(400);
  });
});

describe('creating and joining', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = createRegistry(1);
  });

  it('seats the creator as player one', () => {
    const result = createRoom(registry, 'host', NOW);
    expect(result).toMatchObject({ ok: true, seat: 0 });
  });

  it('seats the second arrival as player two', () => {
    const created = createRoom(registry, 'host', NOW);
    const code = created.ok ? created.room.code : '';
    expect(joinRoom(registry, 'guest', code, NOW)).toMatchObject({ ok: true, seat: 1 });
  });

  it('rejects a code nobody is using', () => {
    expect(joinRoom(registry, 'guest', 'ZZZZZZ', NOW)).toEqual({ ok: false, error: 'room-not-found' });
  });

  it('matches codes case-insensitively', () => {
    // Players type the code by hand; rejecting lowercase is a needless dead end.
    const created = createRoom(registry, 'host', NOW);
    const code = created.ok ? created.room.code : '';
    expect(joinRoom(registry, 'guest', code.toLowerCase(), NOW).ok).toBe(true);
  });

  it('turns away a third player', () => {
    const created = createRoom(registry, 'host', NOW);
    const code = created.ok ? created.room.code : '';
    joinRoom(registry, 'guest', code, NOW);
    expect(joinRoom(registry, 'gatecrasher', code, NOW)).toEqual({ ok: false, error: 'room-full' });
  });

  it('stops one connection being in two rooms at once', () => {
    createRoom(registry, 'host', NOW);
    expect(createRoom(registry, 'host', NOW)).toEqual({ ok: false, error: 'already-in-room' });
  });

  it('finds the room a connection belongs to', () => {
    const created = createRoom(registry, 'host', NOW);
    const code = created.ok ? created.room.code : '';
    expect(roomOf(registry, 'host')?.code).toBe(code);
    expect(roomOf(registry, 'stranger')).toBeNull();
  });
});

describe('leaving', () => {
  let registry: Registry;
  let code: string;

  beforeEach(() => {
    registry = createRegistry(2);
    const created = createRoom(registry, 'host', NOW);
    code = created.ok ? created.room.code : '';
    joinRoom(registry, 'guest', code, NOW);
  });

  it('frees the seat and reports who was left behind', () => {
    const departure = leaveRoom(registry, 'guest');
    expect(departure?.seat).toBe(1);
    expect(departure?.remaining).toEqual(['host']);
    expect(roomOf(registry, 'host')?.players[1]).toBeNull();
  });

  it('lets someone else take the vacated seat', () => {
    leaveRoom(registry, 'guest');
    expect(joinRoom(registry, 'newcomer', code, NOW)).toMatchObject({ ok: true, seat: 1 });
  });

  it('deletes the room once it is empty', () => {
    leaveRoom(registry, 'guest');
    leaveRoom(registry, 'host');
    expect(joinRoom(registry, 'anyone', code, NOW)).toEqual({ ok: false, error: 'room-not-found' });
  });

  it('is harmless for a connection in no room', () => {
    expect(leaveRoom(registry, 'stranger')).toBeNull();
  });

  it('lets a departed connection create a fresh room', () => {
    leaveRoom(registry, 'guest');
    expect(createRoom(registry, 'guest', NOW).ok).toBe(true);
  });
});

describe('character selection and readiness', () => {
  let registry: Registry;
  let code: string;

  beforeEach(() => {
    registry = createRegistry(3);
    const created = createRoom(registry, 'host', NOW);
    code = created.ok ? created.room.code : '';
    joinRoom(registry, 'guest', code, NOW);
  });

  it('records each player’s pick against their own seat', () => {
    selectCharacter(registry, 'host', 'pink');
    selectCharacter(registry, 'guest', 'wizard');
    const room = roomOf(registry, 'host')!;
    expect(room.players[0]?.characterId).toBe('pink');
    expect(room.players[1]?.characterId).toBe('wizard');
  });

  it('lets a player change their mind before starting', () => {
    selectCharacter(registry, 'host', 'pink');
    selectCharacter(registry, 'host', 'alien');
    expect(roomOf(registry, 'host')!.players[0]?.characterId).toBe('alien');
  });

  it('clears readiness when the pick changes', () => {
    // Otherwise a player could ready up, swap character, and start a match the
    // other player never agreed to.
    selectCharacter(registry, 'host', 'pink');
    setReady(registry, 'host', true);
    selectCharacter(registry, 'host', 'alien');
    expect(roomOf(registry, 'host')!.players[0]?.ready).toBe(false);
  });

  it('refuses to start until both have picked and readied', () => {
    const room = roomOf(registry, 'host')!;
    expect(isReadyToStart(room)).toBe(false);

    selectCharacter(registry, 'host', 'pink');
    setReady(registry, 'host', true);
    expect(isReadyToStart(room)).toBe(false);

    selectCharacter(registry, 'guest', 'wizard');
    setReady(registry, 'guest', true);
    expect(isReadyToStart(room)).toBe(true);
  });

  it('refuses to start with an empty seat', () => {
    leaveRoom(registry, 'guest');
    selectCharacter(registry, 'host', 'pink');
    setReady(registry, 'host', true);
    expect(isReadyToStart(roomOf(registry, 'host')!)).toBe(false);
  });

  it('rejects a selection from a connection in no room', () => {
    expect(selectCharacter(registry, 'stranger', 'pink')).toEqual({ ok: false, error: 'not-in-room' });
  });
});

describe('starting a match', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = createRegistry(5);
    const created = createRoom(registry, 'host', NOW);
    const code = created.ok ? created.room.code : '';
    joinRoom(registry, 'guest', code, NOW);
    selectCharacter(registry, 'host', 'pink');
    selectCharacter(registry, 'guest', 'wizard');
    setReady(registry, 'host', true);
    setReady(registry, 'guest', true);
  });

  it('issues both clients the same seed, stage and characters', () => {
    // The seed and stage decide the shape of the match; if the two clients
    // disagreed on either, they would desync on the very first tick.
    const room = roomOf(registry, 'host')!;
    const start = startMatch(registry, room);
    expect(start.p1Character).toBe('pink');
    expect(start.p2Character).toBe('wizard');
    expect(Number.isInteger(start.seed)).toBe(true);
    expect(['freezer', 'magicForest', 'diningTable']).toContain(start.stage);
  });

  it('moves the room out of the lobby', () => {
    const room = roomOf(registry, 'host')!;
    startMatch(registry, room);
    expect(room.phase).toBe('playing');
  });

  it('is reproducible for a given registry seed', () => {
    const build = () => {
      const reg = createRegistry(99);
      const created = createRoom(reg, 'a', NOW);
      const code = created.ok ? created.room.code : '';
      joinRoom(reg, 'b', code, NOW);
      selectCharacter(reg, 'a', 'pink');
      selectCharacter(reg, 'b', 'wizard');
      const room = roomOf(reg, 'a')!;
      return startMatch(reg, room);
    };
    expect(build()).toEqual(build());
  });
});

describe('expiry', () => {
  it('reaps rooms older than the time to live', () => {
    // Rooms live in memory, so an abandoned one is a slow leak. The clock is a
    // parameter precisely so this test does not have to wait half an hour.
    const registry = createRegistry(13);
    createRoom(registry, 'old', NOW);
    createRoom(registry, 'new', NOW + ROOM_TTL_MS);

    const reaped = reapExpired(registry, NOW + ROOM_TTL_MS + 1);

    expect(reaped).toHaveLength(1);
    expect(roomOf(registry, 'old')).toBeNull();
    expect(roomOf(registry, 'new')).not.toBeNull();
  });

  it('reports the connections that were in a reaped room', () => {
    const registry = createRegistry(17);
    const created = createRoom(registry, 'host', NOW);
    joinRoom(registry, 'guest', created.ok ? created.room.code : '', NOW);

    const [reaped] = reapExpired(registry, NOW + ROOM_TTL_MS + 1);
    expect(reaped?.connIds.sort()).toEqual(['guest', 'host']);
  });

  it('leaves everything alone when nothing has expired', () => {
    const registry = createRegistry(19);
    createRoom(registry, 'host', NOW);
    expect(reapExpired(registry, NOW + 1000)).toEqual([]);
  });
});
