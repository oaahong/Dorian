import { expect } from 'vitest';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../../sim/input';
import { createRng, nextFloat, nextInt, type Rng } from '../../sim/rng';
import { checksum, createWorld, stepWorld, type MatchSetup } from '../../sim/world';
import type { PlayerIndex, SimWorld } from '../../sim/types';
import { LockstepSession } from '../LockstepSession';
import type { ChecksumMessage, InputMessage, Transport } from '../Transport';

/**
 * A two-client lockstep match over a link you can make as bad as you like.
 *
 * Shared by every netcode test, because the alternative is each of them carrying
 * its own copy of a virtual clock, a reordering queue and a stall-tolerant step
 * loop — and a bug in one copy is a test that passes for the wrong reason.
 *
 * The network is modelled in ticks against a seeded generator, so a failure is
 * reproducible rather than a once-a-week mystery.
 */

export const DEFAULT_SETUP: MatchSetup = {
  seed: 20260815,
  p1Character: 'pink',
  p2Character: 'wizard',
  stage: 'freezer',
};

const CHECKSUM_INTERVAL = 60;

export interface LinkOptions {
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
export class FakeLink {
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
export class Client {
  readonly world: SimWorld;
  readonly session: LockstepSession;
  readonly checksums = new Map<number, number>();
  stalls = 0;

  constructor(
    readonly player: PlayerIndex,
    transport: Transport,
    inputDelay: number,
    private readonly script: (tick: number) => InputFrame,
    setup: MatchSetup = DEFAULT_SETUP,
    /**
     * Run before each step, on both clients, to arrange a state a script cannot
     * reach on its own — granting meter, for instance.
     *
     * It has to be a pure function of the tick and applied identically at both
     * ends, or it is itself a desync. That is exactly what the tests using it are
     * checking, so a mistake here fails loudly rather than hiding.
     */
    private readonly arrange?: (world: SimWorld, tick: number) => void,
  ) {
    this.world = createWorld(setup);
    this.session = new LockstepSession({ localPlayer: player, inputDelay, transport });
  }

  /** Try to advance one tick. Returns false if it had to wait for the opponent. */
  step(): boolean {
    const tick = this.world.tick;
    this.arrange?.(this.world, tick);
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

export const p1Script = (tick: number): InputFrame =>
  tick % 53 === 0 ? BUTTON.Ultimate
  : tick % 29 === 0 ? BUTTON.Special
  : tick % 17 === 0 ? BUTTON.Heavy
  : tick % 7 === 0 ? BUTTON.Light
  : tick % 3 === 0 ? BUTTON.Right
  : EMPTY_INPUT;

export const p2Script = (tick: number): InputFrame =>
  tick % 59 === 0 ? BUTTON.Ultimate
  : tick % 31 === 0 ? BUTTON.Special
  : tick % 19 === 0 ? BUTTON.Up
  : tick % 11 === 0 ? BUTTON.Heavy
  : tick % 5 === 0 ? BUTTON.Left
  : EMPTY_INPUT;

export interface RunResult {
  a: Client;
  b: Client;
  link: FakeLink;
}

export interface MatchOptions {
  inputDelay?: number;
  setup?: MatchSetup;
  scripts?: [(tick: number) => InputFrame, (tick: number) => InputFrame];
  /** Applied identically on both clients before each step. See `Client`. */
  arrange?: (world: SimWorld, tick: number) => void;
}

export function runMatch(
  options: LinkOptions,
  targetTick: number,
  match: MatchOptions = {},
): RunResult {
  const inputDelay = match.inputDelay ?? 3;
  const [scriptA, scriptB] = match.scripts ?? [p1Script, p2Script];
  const link = new FakeLink(options);
  const a = new Client(0, link.transports[0], inputDelay, scriptA, match.setup, match.arrange);
  const b = new Client(1, link.transports[1], inputDelay, scriptB, match.setup, match.arrange);

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
export function expectAgreement(a: Client, b: Client): void {
  const shared = [...a.checksums.keys()].filter((tick) => b.checksums.has(tick));
  expect(shared.length).toBeGreaterThan(3);
  for (const tick of shared) {
    expect(a.checksums.get(tick), `checksum mismatch at tick ${tick}`).toBe(b.checksums.get(tick));
  }
}

