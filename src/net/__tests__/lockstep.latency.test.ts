import { describe, it, expect } from 'vitest';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../../sim/input';
import { createRng, nextFloat, nextInt, type Rng } from '../../sim/rng';
import { checksum, createWorld, stepWorld, type MatchSetup } from '../../sim/world';
import type { PlayerIndex, SimWorld } from '../../sim/types';
import { LockstepSession } from '../LockstepSession';
import type { ChecksumMessage, InputMessage, Transport } from '../Transport';

/**
 * The core guarantee of the whole netcode: two clients fed the same inputs over a
 * lossy, jittery link end up with byte-identical worlds.
 *
 * Desyncs are the hardest class of bug to reproduce by hand — they need two
 * machines, a bad network and patience — so this is where they get caught. The
 * network is modelled in ticks against a seeded generator so a failure is
 * reproducible rather than a once-a-week mystery.
 */

const SETUP: MatchSetup = {
  seed: 20260815,
  p1Character: 'collapse',
  p2Character: 'wizard',
  stage: 'freezer',
};

const CHECKSUM_INTERVAL = 60;

interface LinkOptions {
  /** One-way delay, in ticks. 6 ticks is a 200 ms round trip. */
  latencyTicks: number;
  /** Extra delay of 0..jitterTicks, drawn per message. */
  jitterTicks?: number;
  /** Fraction of messages dropped outright. */
  lossRate?: number;
  seed?: number;
}

type Envelope =
  | { kind: 'input'; to: 0 | 1; deliverAt: number; message: InputMessage }
  | { kind: 'checksum'; to: 0 | 1; deliverAt: number; message: ChecksumMessage };

/**
 * A two-ended link with a virtual clock.
 *
 * Messages are queued with a delivery tick and released in ascending order of
 * that tick, so a jittered message can legitimately overtake an earlier one —
 * reordering the session has to tolerate, not just latency.
 */
class FakeLink {
  private readonly queue: Envelope[] = [];
  private readonly rng: Rng;
  private now = 0;
  readonly transports: [Transport, Transport];
  private handlers: [
    { input?: (m: InputMessage) => void; checksum?: (m: ChecksumMessage) => void },
    { input?: (m: InputMessage) => void; checksum?: (m: ChecksumMessage) => void },
  ] = [{}, {}];

  dropped = 0;
  delivered = 0;

  constructor(private readonly options: LinkOptions) {
    this.rng = createRng(options.seed ?? 1);
    this.transports = [this.makeTransport(0), this.makeTransport(1)];
  }

  private makeTransport(from: 0 | 1): Transport {
    const to: 0 | 1 = from === 0 ? 1 : 0;
    return {
      sendInput: (message) => this.enqueue({ kind: 'input', to, deliverAt: this.deliveryTick(), message }),
      sendChecksum: (message) => this.enqueue({ kind: 'checksum', to, deliverAt: this.deliveryTick(), message }),
      onInput: (handler) => { this.handlers[from].input = handler; },
      onChecksum: (handler) => { this.handlers[from].checksum = handler; },
    };
  }

  private deliveryTick(): number {
    const jitter = this.options.jitterTicks ? nextInt(this.rng, 0, this.options.jitterTicks + 1) : 0;
    return this.now + this.options.latencyTicks + jitter;
  }

  private enqueue(envelope: Envelope): void {
    if (this.options.lossRate && nextFloat(this.rng) < this.options.lossRate) {
      this.dropped += 1;
      return;
    }
    this.queue.push(envelope);
  }

  /** Advance the virtual clock and deliver everything now due. */
  tick(): void {
    this.now += 1;

    const due: Envelope[] = [];
    const pending: Envelope[] = [];
    for (const envelope of this.queue) {
      (envelope.deliverAt <= this.now ? due : pending).push(envelope);
    }
    if (due.length === 0) return;

    // Keep the not-yet-due messages. Dropping them here would silently turn this
    // harness into a 100%-loss link and make every test below meaningless.
    this.queue.length = 0;
    this.queue.push(...pending);

    for (const envelope of due) {
      this.delivered += 1;
      const handler = this.handlers[envelope.to];
      if (envelope.kind === 'input') handler.input?.(envelope.message);
      else handler.checksum?.(envelope.message);
    }
  }
}

/** One end of the match: its own world, session and scripted player. */
class Client {
  readonly world: SimWorld;
  readonly session: LockstepSession;
  readonly checksums = new Map<number, number>();
  stalls = 0;

  constructor(
    readonly player: PlayerIndex,
    transport: Transport,
    inputDelay: number,
    private readonly script: (tick: number) => InputFrame,
  ) {
    this.world = createWorld(SETUP);
    this.session = new LockstepSession({ localPlayer: player, inputDelay, transport });
  }

  /** Try to advance one tick. Returns false if it had to wait for the opponent. */
  step(): boolean {
    const tick = this.world.tick;
    this.session.submitLocalInput(tick, this.script(tick));

    const inputs = this.session.inputsForTick(tick);
    if (!inputs) {
      this.stalls += 1;
      return false;
    }

    stepWorld(this.world, inputs);
    if (this.world.tick % CHECKSUM_INTERVAL === 0) {
      const hash = checksum(this.world);
      this.checksums.set(this.world.tick, hash);
      this.session.recordChecksum(this.world.tick, hash);
    }
    return true;
  }
}

const p1Script = (tick: number): InputFrame =>
  tick % 53 === 0 ? BUTTON.Down | BUTTON.Special
  : tick % 29 === 0 ? BUTTON.Special
  : tick % 17 === 0 ? BUTTON.Heavy
  : tick % 7 === 0 ? BUTTON.Light
  : tick % 3 === 0 ? BUTTON.Right
  : EMPTY_INPUT;

const p2Script = (tick: number): InputFrame =>
  tick % 59 === 0 ? BUTTON.Down | BUTTON.Special
  : tick % 31 === 0 ? BUTTON.Special
  : tick % 19 === 0 ? BUTTON.Up
  : tick % 11 === 0 ? BUTTON.Heavy
  : tick % 5 === 0 ? BUTTON.Left
  : EMPTY_INPUT;

interface RunResult {
  a: Client;
  b: Client;
  link: FakeLink;
}

function runMatch(options: LinkOptions, targetTick: number, inputDelay = 3): RunResult {
  const link = new FakeLink(options);
  const a = new Client(0, link.transports[0], inputDelay, p1Script);
  const b = new Client(1, link.transports[1], inputDelay, p2Script);

  // Generous ceiling: with a stall the clients need more wall-ticks than sim
  // ticks, and the loop must not spin forever if something is genuinely stuck.
  const maxIterations = targetTick * 6 + 1000;
  for (let i = 0; i < maxIterations; i += 1) {
    if (a.world.tick >= targetTick && b.world.tick >= targetTick) break;
    link.tick();
    if (a.world.tick < targetTick) a.step();
    if (b.world.tick < targetTick) b.step();
  }

  return { a, b, link };
}

/** Compare the checksum both clients recorded at every tick they both reached. */
function expectAgreement(a: Client, b: Client): void {
  const shared = [...a.checksums.keys()].filter((tick) => b.checksums.has(tick));
  expect(shared.length).toBeGreaterThan(3);
  for (const tick of shared) {
    expect(a.checksums.get(tick), `checksum mismatch at tick ${tick}`).toBe(b.checksums.get(tick));
  }
}

describe('lockstep over a simulated link', () => {
  it('converges on a perfect link', () => {
    const { a, b } = runMatch({ latencyTicks: 0 }, 600);
    expect(a.world.tick).toBeGreaterThanOrEqual(600);
    expectAgreement(a, b);
    expect(a.session.status).toBe('ok');
    expect(b.session.status).toBe('ok');
  });

  it('converges at a 100 ms round trip', () => {
    // 3 ticks each way, inside the 3-tick input delay, so it should barely stall.
    const { a, b } = runMatch({ latencyTicks: 3 }, 900);
    expectAgreement(a, b);
    expect(a.session.status).toBe('ok');
  });

  it('converges at a 200 ms round trip with jitter', () => {
    // Beyond what a 3-tick delay hides, so both clients will visibly wait.
    const { a, b } = runMatch({ latencyTicks: 6, jitterTicks: 2, seed: 7 }, 900);
    expectAgreement(a, b);
    expect(a.stalls).toBeGreaterThan(0);
    expect(a.session.status).toBe('ok');
  });

  it('converges through 2% packet loss', () => {
    /**
     * The proof that batching frames into each message is worth it: a dropped
     * message costs nothing because the next one repeats the frames it carried.
     * Without that redundancy this test would deadlock.
     */
    const { a, b, link } = runMatch({ latencyTicks: 4, jitterTicks: 2, lossRate: 0.02, seed: 11 }, 900);
    expect(link.dropped).toBeGreaterThan(0);
    expectAgreement(a, b);
    expect(a.session.status).toBe('ok');
  });

  it('converges through 20% packet loss', () => {
    const { a, b, link } = runMatch({ latencyTicks: 4, jitterTicks: 3, lossRate: 0.2, seed: 13 }, 600);
    expect(link.dropped).toBeGreaterThan(50);
    expectAgreement(a, b);
  });

  it('never reports a desync on a healthy link', () => {
    const { a, b } = runMatch({ latencyTicks: 5, jitterTicks: 3, lossRate: 0.05, seed: 17 }, 900);
    expect(a.session.desyncTick).toBeNull();
    expect(b.session.desyncTick).toBeNull();
  });

  it('reaches identical world state, not merely identical checksums', () => {
    const { a, b } = runMatch({ latencyTicks: 6, jitterTicks: 4, lossRate: 0.05, seed: 19 }, 900);
    expect(a.world.tick).toBe(b.world.tick);
    expect(a.world.fighters[0].hp).toBe(b.world.fighters[0].hp);
    expect(a.world.fighters[1].hp).toBe(b.world.fighters[1].hp);
    expect(a.world.fighters[0].x).toBe(b.world.fighters[0].x);
    expect(a.world.fighters[1].x).toBe(b.world.fighters[1].x);
    expect(a.world.roundWins).toEqual(b.world.roundWins);
    expect(checksum(a.world)).toBe(checksum(b.world));
  });

  it('stalls less with a larger input delay', () => {
    // The trade the player feels: more delay buys smoother play over a worse link.
    const link = { latencyTicks: 7, jitterTicks: 3, seed: 23 };
    const tight = runMatch(link, 600, 2);
    const loose = runMatch(link, 600, 8);
    expect(loose.a.stalls).toBeLessThan(tight.a.stalls);
    expectAgreement(loose.a, loose.b);
  });
});

describe('desync detection over a link', () => {
  it('catches a client whose simulation was tampered with', () => {
    /**
     * Injects the failure the checksum exchange exists to catch. Without it a
     * divergence this small — one fighter nudged by a hundredth of a pixel —
     * would go unreported until the two screens visibly disagreed, by which point
     * there is nothing left to debug from.
     */
    const link = new FakeLink({ latencyTicks: 2 });
    const a = new Client(0, link.transports[0], 3, p1Script);
    const b = new Client(1, link.transports[1], 3, p2Script);

    for (let i = 0; i < 900; i += 1) {
      link.tick();
      a.step();
      b.step();
      if (b.world.tick === 100) b.world.fighters[0].x += 0.01;
    }

    expect([a.session.status, b.session.status]).toContain('desync');
  });
});
