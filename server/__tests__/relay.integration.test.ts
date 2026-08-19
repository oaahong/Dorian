import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import {
  decodeBinary,
  decodeServerMessage,
  encodeChecksum,
  encodeInput,
  encodeJson,
  type ClientMessage,
  type ServerMessage,
} from '../../src/net/protocol';
import { BUTTON } from '../../src/sim/input';
import { startServer, type RunningServer } from '../index';

/**
 * The server driven over real sockets by real clients.
 *
 * The room logic is already covered as pure functions, so what is exercised here
 * is everything those cannot reach: the wiring, the framing, and the behaviour
 * under abuse. Half of these tests send something no honest client would.
 */

class TestClient {
  private readonly socket: WebSocket;
  private readonly messages: ServerMessage[] = [];
  private readonly binary: Buffer[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        this.binary.push(data as Buffer);
        return;
      }
      const message = decodeServerMessage(data.toString());
      if (message) this.messages.push(message);
    });
  }

  static async connect(port: number): Promise<TestClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return new TestClient(socket);
  }

  send(message: ClientMessage): void {
    this.socket.send(encodeJson(message));
  }

  sendRaw(payload: string | Uint8Array): void {
    this.socket.send(payload);
  }

  /** Wait for the next message of a given type, or fail the test on timeout. */
  async next<T extends ServerMessage['t']>(type: T, timeoutMs = 2000): Promise<Extract<ServerMessage, { t: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.messages.findIndex((m) => m.t === type);
      if (index >= 0) return this.messages.splice(index, 1)[0] as Extract<ServerMessage, { t: T }>;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for "${type}"`);
      await delay(10);
    }
  }

  async nextBinary(timeoutMs = 2000): Promise<Buffer> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const packet = this.binary.shift();
      if (packet) return packet;
      if (Date.now() > deadline) throw new Error('Timed out waiting for a binary packet');
      await delay(10);
    }
  }

  received(type: ServerMessage['t']): boolean {
    return this.messages.some((m) => m.t === type);
  }

  get binaryCount(): number {
    return this.binary.length;
  }

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  async waitForClose(timeoutMs = 2000): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await Promise.race([
      new Promise<void>((resolve) => this.socket.once('close', () => resolve())),
      delay(timeoutMs),
    ]);
  }

  close(): void {
    this.socket.close();
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let server: RunningServer;
const clients: TestClient[] = [];

async function connect(): Promise<TestClient> {
  const client = await TestClient.connect(server.port);
  clients.push(client);
  return client;
}

/** Two clients in a room, ready to play. Returns them and the match parameters. */
async function pairUp() {
  const host = await connect();
  const guest = await connect();

  host.send({ t: 'createRoom' });
  const { code } = await host.next('roomState');

  guest.send({ t: 'joinRoom', code });
  await guest.next('roomState');

  host.send({ t: 'selectCharacter', characterId: 'pink' });
  guest.send({ t: 'selectCharacter', characterId: 'wizard' });
  host.send({ t: 'ready', ready: true });
  guest.send({ t: 'ready', ready: true });

  const hostStart = await host.next('matchStart');
  const guestStart = await guest.next('matchStart');
  return { host, guest, code, hostStart, guestStart };
}

beforeEach(async () => {
  server = await startServer({ staticDir: null, seed: 1234 });
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

describe('lobby over a socket', () => {
  it('hands the creator a room code and seat zero', async () => {
    const host = await connect();
    host.send({ t: 'createRoom' });

    const state = await host.next('roomState');
    expect(state.code).toHaveLength(6);
    expect(state.seat).toBe(0);
    expect(state.slots[1]).toBeNull();
  });

  it('tells both players when the second one joins', async () => {
    const host = await connect();
    const guest = await connect();

    host.send({ t: 'createRoom' });
    const { code } = await host.next('roomState');
    guest.send({ t: 'joinRoom', code });

    expect((await guest.next('roomState')).seat).toBe(1);
    // The host must learn about the arrival too, or its lobby never updates.
    expect((await host.next('roomState')).slots[1]).not.toBeNull();
  });

  it('propagates a character choice to the other player', async () => {
    const host = await connect();
    const guest = await connect();
    host.send({ t: 'createRoom' });
    const { code } = await host.next('roomState');
    guest.send({ t: 'joinRoom', code });
    await guest.next('roomState');

    host.send({ t: 'selectCharacter', characterId: 'alien' });

    const state = await guest.next('roomState');
    expect(state.slots[0]?.characterId).toBe('alien');
  });

  it('refuses an unknown room code', async () => {
    const client = await connect();
    client.send({ t: 'joinRoom', code: 'ZZZZZZ' });
    expect((await client.next('error')).code).toBe('room-not-found');
  });

  it('turns away a third player', async () => {
    const { code } = await pairUp();
    const gatecrasher = await connect();
    gatecrasher.send({ t: 'joinRoom', code });
    expect((await gatecrasher.next('error')).code).toBe('room-full');
  });

  it('answers a ping with its own id, for round-trip measurement', async () => {
    const client = await connect();
    client.send({ t: 'ping', id: 99 });
    expect((await client.next('pong')).id).toBe(99);
  });
});

describe('starting a match', () => {
  it('sends both clients identical match parameters', async () => {
    const { hostStart, guestStart } = await pairUp();
    // Any disagreement here is an instant desync on tick zero.
    expect(hostStart).toEqual(guestStart);
    expect(hostStart.p1Character).toBe('pink');
    expect(hostStart.p2Character).toBe('wizard');
    expect(hostStart.inputDelay).toBeGreaterThan(0);
  });

  it('does not start until both players are ready', async () => {
    const host = await connect();
    const guest = await connect();
    host.send({ t: 'createRoom' });
    const { code } = await host.next('roomState');
    guest.send({ t: 'joinRoom', code });
    await guest.next('roomState');

    host.send({ t: 'selectCharacter', characterId: 'pink' });
    host.send({ t: 'ready', ready: true });
    await delay(100);

    expect(host.received('matchStart')).toBe(false);
  });
});

describe('relaying gameplay traffic', () => {
  it('forwards input packets to the opponent only', async () => {
    const { host, guest } = await pairUp();
    const packet = encodeInput({ startTick: 10, frames: [BUTTON.Right, BUTTON.Light] });

    host.sendRaw(packet);

    const received = await guest.nextBinary();
    expect(decodeBinary(received)).toEqual({
      kind: 'input', startTick: 10, frames: [BUTTON.Right, BUTTON.Light],
    });
    // The sender must not receive its own packet back, or it would count as the
    // opponent's input and both clients would simulate the same fighter twice.
    expect(host.binaryCount).toBe(0);
  });

  it('forwards an extension tail through untouched', async () => {
    /**
     * The ack and the piggybacked checksum ride in a tail appended after the
     * frames. The relay validates with `decodeBinary` and drops what it cannot
     * parse, so this is the test behind the claim that a server which predates
     * the tail still forwards it: the length checks are minimums, so unknown
     * trailing bytes survive the round trip byte for byte.
     */
    const { host, guest } = await pairUp();
    const packet = encodeInput({
      startTick: 42,
      frames: [BUTTON.Right],
      nextWanted: 39,
      checksum: { tick: 60, hash: 0xabcdef },
    });

    host.sendRaw(packet);

    const received = await guest.nextBinary();
    expect(new Uint8Array(received)).toEqual(packet);
    expect(decodeBinary(received)).toEqual({
      kind: 'input',
      startTick: 42,
      frames: [BUTTON.Right],
      nextWanted: 39,
      checksum: { tick: 60, hash: 0xabcdef },
    });
  });

  it('forwards checksum packets', async () => {
    const { host, guest } = await pairUp();
    host.sendRaw(encodeChecksum({ tick: 60, hash: 0xabcdef }));
    expect(decodeBinary(await guest.nextBinary())).toEqual({
      kind: 'checksum', tick: 60, hash: 0xabcdef,
    });
  });

  it('carries a hundred ticks of input in order', async () => {
    const { host, guest } = await pairUp();
    for (let tick = 0; tick < 100; tick += 1) {
      host.sendRaw(encodeInput({ startTick: tick, frames: [tick % 0x7f] }));
    }

    const received: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      const packet = decodeBinary(await guest.nextBinary());
      if (packet?.kind === 'input') received.push(packet.startTick);
    }
    expect(received).toEqual([...Array(100).keys()]);
  });

  it('drops a malformed binary packet instead of relaying it', async () => {
    const { host, guest } = await pairUp();
    host.sendRaw(new Uint8Array([99, 1, 2, 3]));
    await delay(100);
    expect(guest.binaryCount).toBe(0);
  });

  it('ignores gameplay traffic from a connection in no room', async () => {
    const loner = await connect();
    expect(() => loner.sendRaw(encodeInput({ startTick: 0, frames: [1] }))).not.toThrow();
    await delay(50);
    expect(loner.isOpen).toBe(true);
  });
});

describe('disconnection', () => {
  it('tells the remaining player when their opponent drops', async () => {
    const { host, guest } = await pairUp();
    guest.close();
    await host.next('opponentLeft');
  });

  it('frees the seat so someone else can take it', async () => {
    const { code, guest } = await pairUp();
    guest.close();
    await delay(100);

    const replacement = await connect();
    replacement.send({ t: 'joinRoom', code });
    expect((await replacement.next('roomState')).seat).toBe(1);
  });

  it('handles an explicit leave the same as a dropped socket', async () => {
    const { host, guest } = await pairUp();
    guest.send({ t: 'leave' });
    await host.next('opponentLeft');
  });
});

describe('abuse', () => {
  it('reports a malformed lobby message without dropping the connection', async () => {
    const client = await connect();
    client.sendRaw('not json at all');
    expect((await client.next('error')).code).toBe('bad-message');
    expect(client.isOpen).toBe(true);
  });

  it('survives a message with an unknown type', async () => {
    const client = await connect();
    client.sendRaw(JSON.stringify({ t: 'shutdownEverything' }));
    await client.next('error');
    expect(client.isOpen).toBe(true);
  });

  it('closes a connection that floods the server', async () => {
    const client = await connect();
    for (let i = 0; i < 500; i += 1) client.send({ t: 'ping', id: i });
    await client.waitForClose();
    expect(client.isOpen).toBe(false);
  });

  it('keeps serving other clients after one is dropped for flooding', async () => {
    const flooder = await connect();
    const wellBehaved = await connect();
    for (let i = 0; i < 500; i += 1) flooder.send({ t: 'ping', id: i });
    await flooder.waitForClose();

    wellBehaved.send({ t: 'createRoom' });
    expect((await wellBehaved.next('roomState')).code).toHaveLength(6);
  });

  it('serves a health check over plain HTTP', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });
});
