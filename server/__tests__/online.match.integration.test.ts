import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LockstepSession } from '../../src/net/LockstepSession';
import {
  OnlineClient,
  type MatchStart,
  type OnlineClientEvents,
  type SocketLike,
} from '../../src/net/OnlineClient';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../../src/sim/input';
import { checksum, createWorld, stepWorld } from '../../src/sim/world';
import type { PlayerIndex, SimWorld } from '../../src/sim/types';
import { startServer, type RunningServer } from '../index';

/**
 * The full online path, end to end and headless: two clients, one server, real
 * sockets, real lockstep, a real match.
 *
 * Everything below has unit coverage already; what this proves is that the parts
 * fit — that the seed and characters the server picks, the frames the transport
 * encodes and the ticks the session gates all line up well enough for two
 * separate simulations to stay byte-identical. It is the same claim the browser
 * test makes, without the browser, so it runs in a second and can be trusted as a
 * gate.
 */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let server: RunningServer;
const sockets: WebSocket[] = [];

async function openClient(events: OnlineClientEvents = {}): Promise<OnlineClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('socket failed to open')), { once: true });
  });
  return new OnlineClient(socket as unknown as SocketLike, events);
}

/** One end of the match: its own world, session and scripted player. */
class Peer {
  world: SimWorld | null = null;
  session: LockstepSession | null = null;
  stalls = 0;
  readonly checksums = new Map<number, number>();

  constructor(
    readonly client: OnlineClient,
    readonly script: (tick: number) => InputFrame,
  ) {}

  begin(start: MatchStart, seat: PlayerIndex): void {
    this.world = createWorld({
      seed: start.seed,
      stage: start.stage,
      p1Character: start.p1Character,
      p2Character: start.p2Character,
    });
    this.session = new LockstepSession({
      localPlayer: seat,
      inputDelay: start.inputDelay,
      transport: this.client,
    });
  }

  step(): boolean {
    if (!this.world || !this.session) return false;
    const tick = this.world.tick;
    this.session.submitLocalInput(tick, this.script(tick));

    const inputs = this.session.inputsForTick(tick);
    if (!inputs) {
      this.stalls += 1;
      return false;
    }

    stepWorld(this.world, inputs);
    if (this.world.tick % 60 === 0) {
      const hash = checksum(this.world);
      this.checksums.set(this.world.tick, hash);
      this.session.recordChecksum(this.world.tick, hash);
    }
    return true;
  }
}

const hostScript = (tick: number): InputFrame =>
  tick % 47 === 0 ? BUTTON.Down | BUTTON.Special
  : tick % 23 === 0 ? BUTTON.Heavy
  : tick % 9 === 0 ? BUTTON.Light
  : tick % 3 === 0 ? BUTTON.Right
  : EMPTY_INPUT;

const guestScript = (tick: number): InputFrame =>
  tick % 53 === 0 ? BUTTON.Down | BUTTON.Special
  : tick % 19 === 0 ? BUTTON.Up
  : tick % 13 === 0 ? BUTTON.Heavy
  : tick % 5 === 0 ? BUTTON.Left
  : EMPTY_INPUT;

/** Pair two clients up through the server and start a match on both. */
async function startMatch(): Promise<{ host: Peer; guest: Peer }> {
  let hostStart: MatchStart | null = null;
  let guestStart: MatchStart | null = null;
  let code = '';
  let hostSeat: PlayerIndex = 0;
  let guestSeat: PlayerIndex = 1;

  const hostClient = await openClient({
    onRoomState: (state) => { code = state.code; hostSeat = state.seat; },
    onMatchStart: (start) => { hostStart = start; },
  });
  const guestClient = await openClient({
    onRoomState: (state) => { guestSeat = state.seat; },
    onMatchStart: (start) => { guestStart = start; },
  });

  hostClient.createRoom();
  await waitFor(() => code !== '');

  guestClient.joinRoom(code);
  await waitFor(() => guestSeat === 1);

  hostClient.selectCharacter('pink');
  guestClient.selectCharacter('wizard');
  hostClient.setReady(true);
  guestClient.setReady(true);

  await waitFor(() => hostStart !== null && guestStart !== null);

  const host = new Peer(hostClient, hostScript);
  const guest = new Peer(guestClient, guestScript);
  host.begin(hostStart!, hostSeat);
  guest.begin(guestStart!, guestSeat);
  return { host, guest };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a condition');
    await delay(5);
  }
}

/** Run both peers until they reach `targetTick`, letting the sockets drain. */
async function playTo(host: Peer, guest: Peer, targetTick: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while ((host.world?.tick ?? 0) < targetTick || (guest.world?.tick ?? 0) < targetTick) {
    if (Date.now() > deadline) throw new Error('Match did not reach the target tick');
    // A handful of ticks per event-loop turn: enough to make progress, but the
    // await is what lets queued socket messages actually be delivered.
    for (let i = 0; i < 4; i += 1) {
      if ((host.world?.tick ?? 0) < targetTick) host.step();
      if ((guest.world?.tick ?? 0) < targetTick) guest.step();
    }
    await delay(0);
  }
}

beforeEach(async () => {
  // The rate limit is raised because this test plays a match as fast as the
  // event loop allows, which is roughly twenty times real time. Flood protection
  // itself is covered against the default limit in relay.integration.test.ts.
  server = await startServer({ staticDir: null, seed: 4242, rateLimitPerSecond: 100_000 });
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server.close();
});

describe('an online match over real sockets', () => {
  it('gives both clients the same match parameters', async () => {
    const { host, guest } = await startMatch();
    expect(host.world!.stage).toBe(guest.world!.stage);
    expect(host.world!.fighters[0].configId).toBe(guest.world!.fighters[0].configId);
    expect(host.world!.fighters[1].configId).toBe(guest.world!.fighters[1].configId);
    expect(checksum(host.world!)).toBe(checksum(guest.world!));
  });

  it('seats the two players on opposite sides', async () => {
    const { host, guest } = await startMatch();
    expect(host.session!.localPlayer).toBe(0);
    expect(guest.session!.localPlayer).toBe(1);
  });

  it('stays byte-identical across a played-out match', async () => {
    const { host, guest } = await startMatch();
    await playTo(host, guest, 600);

    expect(host.world!.tick).toBe(guest.world!.tick);
    expect(checksum(host.world!)).toBe(checksum(guest.world!));
    expect(host.world!.fighters[0].hp).toBe(guest.world!.fighters[0].hp);
    expect(host.world!.fighters[1].hp).toBe(guest.world!.fighters[1].hp);
    expect(host.world!.roundWins).toEqual(guest.world!.roundWins);
  });

  it('agrees at every checkpoint, not only at the end', async () => {
    const { host, guest } = await startMatch();
    await playTo(host, guest, 600);

    const shared = [...host.checksums.keys()].filter((tick) => guest.checksums.has(tick));
    expect(shared.length).toBeGreaterThan(5);
    for (const tick of shared) {
      expect(host.checksums.get(tick), `tick ${tick}`).toBe(guest.checksums.get(tick));
    }
  });

  it('reports no desync', async () => {
    const { host, guest } = await startMatch();
    await playTo(host, guest, 600);
    expect(host.session!.status).not.toBe('desync');
    expect(guest.session!.status).not.toBe('desync');
    expect(host.session!.desyncTick).toBeNull();
  });

  it('barely stalls on a local connection', async () => {
    const { host, guest } = await startMatch();
    await playTo(host, guest, 600);
    // Loopback latency is far inside the input delay, so waiting should be rare.
    expect(host.stalls).toBeLessThan(600);
  });

  it('measures a round-trip time from pings', async () => {
    const { host } = await startMatch();
    host.client.startPinging();
    await waitFor(() => host.client.roundTripMs !== null, 5000);
    expect(host.client.roundTripMs).toBeGreaterThanOrEqual(0);
    expect(host.client.suggestedInputDelay()).toBeGreaterThanOrEqual(2);
    host.client.stopPinging();
  });

  it('notices when the opponent disconnects mid-match', async () => {
    let opponentLeft = false;
    const { host, guest } = await startMatch();
    // Re-registering is fine: the client stores one handler per event.
    (host.client as unknown as { events: { onOpponentLeft?: () => void } }).events.onOpponentLeft =
      () => { opponentLeft = true; };

    await playTo(host, guest, 120);
    guest.client.close();

    await waitFor(() => opponentLeft, 3000);
    expect(opponentLeft).toBe(true);
  });
});

describe('input delay suggestion', () => {
  it('grows with the measured round trip', async () => {
    const client = await openClient();
    const withoutSample = client.suggestedInputDelay();

    (client as unknown as { roundTripMs: number }).roundTripMs = 200;
    expect(client.suggestedInputDelay()).toBeGreaterThan(withoutSample);
  });

  it('sizes the delay for the relayed path, not a direct one', async () => {
    /**
     * Traffic goes `me -> server -> them`. With both players a similar distance
     * from the server that costs about a full round trip, so a 50 ms link needs
     * three ticks of cover for the network plus two for the two render frames,
     * plus one for jitter.
     */
    const client = await openClient();
    (client as unknown as { roundTripMs: number }).roundTripMs = 50;
    expect(client.suggestedInputDelay({ frameIntervalMs: 1000 / 60 })).toBe(6);

    (client as unknown as { roundTripMs: number }).roundTripMs = 100;
    expect(client.suggestedInputDelay({ frameIntervalMs: 1000 / 60 })).toBe(9);
  });

  it('asks for less on a direct link than a relayed one', async () => {
    const client = await openClient();
    (client as unknown as { roundTripMs: number }).roundTripMs = 100;
    const relayed = client.suggestedInputDelay({ direct: false });
    const direct = client.suggestedInputDelay({ direct: true });
    expect(direct).toBeLessThan(relayed);
  });

  it('grows when the client is rendering slowly', async () => {
    /**
     * The term that is easy to forget and can dominate: an arriving frame is not
     * acted on until the next rendered frame, on both machines. At 18 fps that is
     * 110 ms of the path — more than a transatlantic round trip — and leaving it
     * out sized the delay at 50 ms for a link that actually needed 160.
     */
    const client = await openClient();
    (client as unknown as { roundTripMs: number }).roundTripMs = 20;

    const healthy = client.suggestedInputDelay({ frameIntervalMs: 1000 / 60 });
    const struggling = client.suggestedInputDelay({ frameIntervalMs: 1000 / 18 });
    expect(struggling).toBeGreaterThan(healthy);
    expect(struggling).toBeGreaterThanOrEqual(8);
  });

  it('stays within its bounds however bad things get', async () => {
    const client = await openClient();
    (client as unknown as { roundTripMs: number }).roundTripMs = 5000;
    expect(client.suggestedInputDelay({ max: 6 })).toBe(6);

    (client as unknown as { roundTripMs: number }).roundTripMs = 1;
    expect(client.suggestedInputDelay({ min: 2, max: 12, frameIntervalMs: 1 })).toBeGreaterThanOrEqual(2);
  });
});
