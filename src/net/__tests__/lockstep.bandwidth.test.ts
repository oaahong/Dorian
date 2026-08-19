import { describe, it, expect } from 'vitest';
import { checksum } from '../../sim/world';
import { expectAgreement, runMatch, type LinkOptions } from './linkHarness';

/**
 * What the ack window costs on the wire, measured rather than asserted in a
 * comment.
 *
 * The fixed window repeated `max(12, 3 * inputDelay)` frames in every message
 * whether or not the opponent already had them. The ack window repeats only what
 * has not been confirmed, plus a small floor. These tests pin the saving so that
 * a future change which quietly reverts to blanket redundancy shows up as a
 * failure rather than as a slightly larger bill.
 *
 * `legacySender` on both seats reproduces the old behaviour exactly — a client
 * that sends no ack leaves its peer on the fixed window — so each case is the
 * same match, same seed, same scripts, run twice.
 */

const TARGET_TICK = 600;

function compare(link: LinkOptions, inputDelay: number) {
  const modern = runMatch(link, TARGET_TICK, { inputDelay });
  const legacy = runMatch({ ...link, legacySender: [true, true] }, TARGET_TICK, { inputDelay });
  return { modern, legacy, ratio: modern.link.bytesSent / legacy.link.bytesSent };
}

describe('the ack window', () => {
  it('sends less than the fixed window at a low input delay', () => {
    const { modern, legacy, ratio } = compare({ latencyTicks: 2 }, 3);
    expectAgreement(modern.a, modern.b);
    expect(modern.link.truncations).toBe(0);
    expect(ratio).toBeLessThan(0.75);
    expect(legacy.link.bytesSent).toBeGreaterThan(modern.link.bytesSent);
  });

  it('saves more at a high input delay, where the fixed window was widest', () => {
    // The relayed path: delay 12 repeated 36 frames a message regardless.
    const { modern, ratio } = compare({ latencyTicks: 6, jitterTicks: 2 }, 12);
    expectAgreement(modern.a, modern.b);
    expect(modern.link.truncations).toBe(0);
    expect(ratio).toBeLessThan(0.6);
  });

  it('reaches byte-identical worlds, so the saving costs nothing', () => {
    /**
     * The strongest available statement that this change is bandwidth-only: the
     * ack run and the fixed run finish on the same world, not merely on matching
     * checksums within each run. It holds because the scripts are pure functions
     * of the tick and the simulation is driven by `(tick, inputs)`, even though
     * the two runs stall at different moments.
     */
    const { modern, legacy } = compare({ latencyTicks: 3, lossRate: 0.05, seed: 7 }, 4);
    expect(checksum(modern.a.world)).toBe(checksum(legacy.a.world));
    expect(checksum(modern.b.world)).toBe(checksum(legacy.b.world));
  });

  it('still converges through 20% loss, where the window has to grow back', () => {
    // Losing packets stalls the peer's ack, which widens the window on its own —
    // the property that makes this safer than a width guessed from the delay.
    const { modern } = compare({ latencyTicks: 3, lossRate: 0.2, seed: 11 }, 8);
    expectAgreement(modern.a, modern.b);
    expect(modern.link.truncations).toBe(0);
    expect(modern.a.world.tick).toBeGreaterThanOrEqual(TARGET_TICK);
  });

  it('falls back to the fixed window against a peer that never acks', () => {
    // One seat old, one new. The staged-deploy case, tested rather than assumed.
    const mixed = runMatch(
      { latencyTicks: 4, lossRate: 0.15, seed: 3, legacySender: [true, false] },
      TARGET_TICK,
      { inputDelay: 8 },
    );
    expectAgreement(mixed.a, mixed.b);
    expect(mixed.a.world.tick).toBeGreaterThanOrEqual(TARGET_TICK);
    expect(mixed.link.truncations).toBe(0);
  });
});
