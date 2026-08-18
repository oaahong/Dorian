import { describe, it, expect } from 'vitest';
import { BUTTON } from '../../sim/input';
import { checksum } from '../../sim/world';
import { Client, FakeLink, expectAgreement, p1Script, p2Script, runMatch } from './linkHarness';

/**
 * The core guarantee of the whole netcode: two clients fed the same inputs over a
 * lossy, jittery link end up with byte-identical worlds.
 *
 * Desyncs are the hardest class of bug to reproduce by hand — they need two
 * machines, a bad network and patience — so this is where they get caught. The
 * link itself lives in `linkHarness.ts`, shared with the other netcode tests.
 */

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
    const tight = runMatch(link, 600, { inputDelay: 2 });
    const loose = runMatch(link, 600, { inputDelay: 8 });
    expect(loose.a.stalls).toBeLessThan(tight.a.stalls);
    expectAgreement(loose.a, loose.b);
  });
});

describe('recovering a lost message', () => {
  it('survives a drop even when a client is a full delay behind', () => {
    /**
     * The window of repeated frames has to be wider than the input delay. A
     * client may legitimately sit `inputDelay` ticks behind, so a window only
     * that wide is already sliding past the frames it still needs — and on an
     * unreliable channel one dropped message then deadlocks the match for good.
     *
     * Run with a delay of 8 and 15% loss, which is the shape of the failure seen
     * on a real deployment: both clients waiting on frames the other had long
     * since stopped repeating.
     */
    const { a, b } = runMatch({ latencyTicks: 3, jitterTicks: 2, lossRate: 0.15, seed: 31 }, 600, { inputDelay: 8 });

    expect(a.world.tick).toBeGreaterThanOrEqual(600);
    expect(b.world.tick).toBeGreaterThanOrEqual(600);
    expectAgreement(a, b);
  });
});

describe('a player pressing keys during a stall', () => {
  it('cannot make the two simulations diverge', () => {
    /**
     * Reproduces the bug that made online matches drop as soon as anyone touched
     * the keyboard. A stalled client is asked for its buttons on every rendered
     * frame, not every tick, so a player mid-press gives a different answer each
     * time — and the session used to overwrite the frame it had already sent. The
     * opponent keeps the first value it receives, so the two ran that tick from
     * different inputs and the checksum exchange reported a desync, which the
     * battle scene treats as a lost connection.
     *
     * The offer is now final once transmitted, so the mashing is simply ignored.
     */
    const link = new FakeLink({ latencyTicks: 5, jitterTicks: 3, seed: 29 });
    const a = new Client(0, link.transports[0], 3, p1Script);
    const b = new Client(1, link.transports[1], 3, p2Script);

    let mashCounter = 0;
    for (let i = 0; i < 4000; i += 1) {
      link.tick();

      // Client A behaves as the scene used to: it offers a fresh, different frame
      // for its current tick on every iteration, stalled or not.
      mashCounter += 1;
      a.session.submitLocalInput(a.world.tick, mashCounter % 2 === 0 ? BUTTON.Light : BUTTON.Heavy);

      // Stopped at the same tick on both sides: comparing whole-world checksums
      // taken at different ticks would compare two different moments and fail for
      // a reason that has nothing to do with agreement.
      if (a.world.tick < 400) a.step();
      if (b.world.tick < 400) b.step();
      if (a.world.tick >= 400 && b.world.tick >= 400) break;
    }

    expect(a.world.tick).toBe(400);
    expect(b.world.tick).toBe(400);
    expect(a.session.status).not.toBe('desync');
    expect(b.session.status).not.toBe('desync');
    expectAgreement(a, b);
    expect(checksum(a.world)).toBe(checksum(b.world));
  });
});

describe('the input delay must be identical on both clients', () => {
  it('deadlocks when the two disagree', () => {
    /**
     * Not a suggestion — a requirement, and an invisible one. The delay decides
     * how many opening ticks run on primed neutral input. A client with delay 3
     * primes ticks 0-2 and first transmits a frame for tick 3; a client with
     * delay 2 primes 0-1 and waits for a frame for tick 2 that the other was
     * never going to send. Both stall a few ticks in, which looks exactly like a
     * dead connection.
     *
     * This cost a deployment to find, because every client on one machine
     * measures the same round trip and agrees by accident. The lobby now settles
     * the delay between the two clients rather than each computing its own.
     */
    const link = new FakeLink({ latencyTicks: 1 });
    const a = new Client(0, link.transports[0], 3, p1Script);
    const b = new Client(1, link.transports[1], 2, p2Script);

    for (let i = 0; i < 400; i += 1) {
      link.tick();
      a.step();
      b.step();
    }

    expect(a.world.tick, 'the client with the larger delay stalls early').toBeLessThan(10);
    expect(b.world.tick, 'so does the other one').toBeLessThan(10);
    expect(a.session.status).toBe('waiting');
    expect(b.session.status).toBe('waiting');
  });

  it('runs normally when they match', () => {
    const { a, b } = runMatch({ latencyTicks: 1 }, 300, { inputDelay: 3 });
    expect(a.world.tick).toBeGreaterThanOrEqual(300);
    expectAgreement(a, b);
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
