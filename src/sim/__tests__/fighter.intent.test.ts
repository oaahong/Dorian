import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../input';
import { BLOCK_STANCE_RANGE, GROUND_Y, INPUT_BUFFER_TICKS, MAX_ENERGY, P1_SPAWN_X, msToTicks } from '../constants';
import { canUseSpecial, createFighter, stepFighter } from '../fighter';
import type { SimEvent, SimFighter } from '../types';

/**
 * Input derivation and the priority order inside processIntent.
 *
 * All of this used to live in PlayerController (edges via Phaser's JustDown, the
 * 140 ms crouch buffer) or was inferred from opponent position (blocking). It now
 * happens inside the simulation so a resimulation of the same raw button bytes
 * reaches the same decisions. See docs/sim-spec.md §2, §3 and §5.
 */

function harness(overrides: Partial<SimFighter> = {}, opponentX = 700) {
  const self = { ...createFighter('pink', P1_SPAWN_X, 1), ...overrides };
  const opponent = createFighter('ok', opponentX, -1);
  let tick = 0;
  return {
    self,
    opponent,
    get tick() { return tick; },
    run(input: InputFrame = EMPTY_INPUT, ticks = 1): SimEvent[] {
      const events: SimEvent[] = [];
      for (let i = 0; i < ticks; i += 1) {
        stepFighter(self, opponent, input, tick, true, 0, events);
        tick += 1;
      }
      return events;
    },
  };
}

describe('button edges', () => {
  it('fires an attack once per press, not once per held tick', () => {
    const h = harness();
    h.run(BUTTON.Light);
    expect(h.self.state).toBe(FighterState.LIGHT_ATTACK);

    // Hold through the whole attack; the fighter must return to idle rather than
    // immediately starting another light.
    h.run(BUTTON.Light, 40);
    expect(h.self.state).toBe(FighterState.IDLE);
  });

  it('allows a second attack after releasing and pressing again', () => {
    const h = harness();
    h.run(BUTTON.Light);
    h.run(BUTTON.Light, 40);
    h.run(EMPTY_INPUT);
    h.run(BUTTON.Light);
    expect(h.self.state).toBe(FighterState.LIGHT_ATTACK);
  });

  it('records the previous button mask each tick', () => {
    const h = harness();
    h.run(BUTTON.Right);
    expect(h.self.prevButtons).toBe(BUTTON.Right);
    h.run(BUTTON.Right | BUTTON.Down);
    expect(h.self.prevButtons).toBe(BUTTON.Right | BUTTON.Down);
  });
});

describe('special versus ultimate', () => {
  it('treats a bare special press as the special', () => {
    const h = harness();
    h.run(BUTTON.Special);
    expect(h.self.state).toBe(FighterState.SPECIAL);
  });

  it('treats down + special as the ultimate when the meter is full', () => {
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Down | BUTTON.Special);
    expect(h.self.state).toBe(FighterState.ULTIMATE);
    expect(h.self.energy).toBe(0);
  });

  it('honours the crouch buffer after down is released', () => {
    // Pressing down and then special a few ticks later still reads as an
    // ultimate motion — the 140 ms buffer, now INPUT_BUFFER_TICKS.
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Down);
    h.run(EMPTY_INPUT, INPUT_BUFFER_TICKS - 2);
    h.run(BUTTON.Special);
    expect(h.self.state).toBe(FighterState.ULTIMATE);
  });

  it('expires the crouch buffer', () => {
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Down);
    h.run(EMPTY_INPUT, INPUT_BUFFER_TICKS + 2);
    h.run(BUTTON.Special);
    expect(h.self.state).toBe(FighterState.SPECIAL);
    expect(h.self.energy).toBe(MAX_ENERGY);
  });

  it('falls back to the special when the meter is short', () => {
    // Ported behaviour: an ultimate motion without meter is not a whiff, it comes
    // out as the special.
    const h = harness({ energy: 99 });
    h.run(BUTTON.Down | BUTTON.Special);
    expect(h.self.state).toBe(FighterState.SPECIAL);
    expect(h.self.energy).toBe(99);
  });

  it('spends the whole meter on the ultimate', () => {
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Down | BUTTON.Special);
    expect(h.self.energy).toBe(0);
  });
});

describe('special cooldown', () => {
  it('is on cooldown immediately after use', () => {
    const h = harness();
    h.run(BUTTON.Special);
    expect(canUseSpecial(h.self, h.tick)).toBe(false);
  });

  it('comes back after the scaled cooldown elapses', () => {
    const h = harness();
    h.run(BUTTON.Special);
    h.run(EMPTY_INPUT, 200);
    expect(canUseSpecial(h.self, h.tick)).toBe(true);
  });

  it('scales the cooldown by the control stat, using the 1.08 curve', () => {
    /**
     * Asserted as an exact value rather than by comparing two fighters: the base
     * cooldowns differ per character and dominate the control-stat term, so a
     * cross-fighter comparison would say nothing about the scaling.
     *
     * Special cooldowns use `1.08 - stat * 0.025`, distinct from the `1.05`
     * curve that scales attack recovery. See docs/sim-spec.md §1.
     */
    const h = harness({ configId: 'ok' }); // controlStat 5, 90-tick cooldown
    h.run(BUTTON.Special);
    const cooldownTicks = 90;
    expect(h.self.nextSpecialTick).toBeCloseTo(cooldownTicks * (1.08 - 5 * 0.025), 10);
  });

  it('blocks a special while attacking or stunned', () => {
    const stunned = harness({ state: FighterState.HITSTUN, stateRemainingTicks: 5 });
    expect(canUseSpecial(stunned.self, 0)).toBe(false);

    const ko = harness({ state: FighterState.KO });
    expect(canUseSpecial(ko.self, 0)).toBe(false);
  });
});

describe('intent priority', () => {
  it('prefers blocking over attacking when holding away', () => {
    // Away is left, since the opponent is to the right.
    const h = harness({ x: 600 }, 700);
    h.run(BUTTON.Left | BUTTON.Light);
    expect(h.self.state).toBe(FighterState.BLOCK);
  });

  it('prefers the ultimate over a normal attack', () => {
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Down | BUTTON.Special | BUTTON.Light | BUTTON.Heavy);
    expect(h.self.state).toBe(FighterState.ULTIMATE);
  });

  it('prefers light over heavy when both are pressed', () => {
    const h = harness();
    h.run(BUTTON.Light | BUTTON.Heavy);
    expect(h.self.state).toBe(FighterState.LIGHT_ATTACK);
  });

  it('prefers an attack over a jump', () => {
    const h = harness();
    h.run(BUTTON.Light | BUTTON.Up);
    expect(h.self.state).toBe(FighterState.LIGHT_ATTACK);
  });

  it('prefers a jump over crouching', () => {
    const h = harness();
    h.run(BUTTON.Up | BUTTON.Down);
    expect(h.self.state).toBe(FighterState.JUMP);
  });

  it('prefers crouching over walking', () => {
    const h = harness();
    h.run(BUTTON.Down | BUTTON.Right);
    expect(h.self.state).toBe(FighterState.CROUCH);
  });

  it('starts a crouching attack that keeps the crouch flag', () => {
    const h = harness();
    h.run(BUTTON.Down | BUTTON.Light);
    expect(h.self.state).toBe(FighterState.LIGHT_ATTACK);
    expect(h.self.attack?.crouching).toBe(true);
  });
});

describe('airborne intent', () => {
  it('allows only light and heavy in the air', () => {
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Up);
    h.run(BUTTON.Special, 3);
    expect(h.self.state).toBe(FighterState.JUMP);
    expect(h.self.energy).toBe(MAX_ENERGY);
  });

  it('marks an air attack as airborne', () => {
    const h = harness();
    h.run(BUTTON.Up);
    h.run(BUTTON.Heavy);
    expect(h.self.attack?.airborne).toBe(true);
    expect(h.self.attack?.crouching).toBe(false);
  });

  it('cannot block in the air', () => {
    const h = harness({ x: 600 }, 700);
    h.run(BUTTON.Up);
    h.run(BUTTON.Left, 3);
    expect(h.self.state).toBe(FighterState.JUMP);
  });
});

describe('blocking', () => {
  it('enters the block stance holding away inside the stance range', () => {
    const h = harness({ x: 600 }, 700);
    h.run(BUTTON.Left);
    expect(h.self.state).toBe(FighterState.BLOCK);
    expect(h.self.vx).toBe(0);
    expect(h.self.guardHeld).toBe(true);
  });

  it('walks away instead of blocking beyond the stance range', () => {
    const h = harness({ x: 200 }, 200 + BLOCK_STANCE_RANGE + 50);
    h.run(BUTTON.Left);
    expect(h.self.state).toBe(FighterState.WALK);
  });

  it('still counts as guarding beyond the stance range', () => {
    /**
     * Deliberately preserved quirk: `guardHeld` has no range condition, only the
     * BLOCK *stance* does. So a fighter walking away from a distant opponent will
     * still block an incoming projectile. See docs/sim-spec.md §5.
     */
    const h = harness({ x: 200 }, 200 + BLOCK_STANCE_RANGE + 50);
    h.run(BUTTON.Left);
    expect(h.self.state).toBe(FighterState.WALK);
    expect(h.self.guardHeld).toBe(true);
  });

  it('does not guard while crouching', () => {
    const h = harness({ x: 600 }, 700);
    h.run(BUTTON.Left | BUTTON.Down);
    expect(h.self.guardHeld).toBe(false);
    expect(h.self.state).toBe(FighterState.CROUCH);
  });

  it('does not guard while walking toward the opponent', () => {
    const h = harness({ x: 600 }, 700);
    h.run(BUTTON.Right);
    expect(h.self.guardHeld).toBe(false);
  });

  it('flips which direction guards when the fighters swap sides', () => {
    const h = harness({ x: 800 }, 700);
    h.run(BUTTON.Right); // away is now right
    expect(h.self.state).toBe(FighterState.BLOCK);
  });

  it('clears the guard as soon as the direction is released', () => {
    const h = harness({ x: 600 }, 700);
    h.run(BUTTON.Left);
    expect(h.self.guardHeld).toBe(true);
    h.run(EMPTY_INPUT);
    expect(h.self.guardHeld).toBe(false);
    expect(h.self.state).toBe(FighterState.IDLE);
  });
});

describe('motion-selected specials', () => {
  /**
   * The roster gives each fighter three or four specials, told apart by the
   * motion in front of the button. `scared` is the one with all four, so it is
   * the only fighter that exercises every branch.
   */
  const scared = () => harness({ configId: 'scared' });

  /** Walk a motion in, one direction per tick, then press special. */
  const inputMotion = (h: ReturnType<typeof harness>, directions: InputFrame[]) => {
    for (const direction of directions) h.run(direction);
    h.run(BUTTON.Special);
    return h.self.attack?.specId;
  };

  it('throws the 236 special for a quarter-circle forward', () => {
    // Opponent is to the right, so forward is right.
    const h = scared();
    expect(inputMotion(h, [BUTTON.Down, BUTTON.Down | BUTTON.Right, BUTTON.Right]))
      .toBe('scared-scream');
  });

  it('throws the 214 special for a quarter-circle back', () => {
    const h = scared();
    expect(inputMotion(h, [BUTTON.Down, BUTTON.Down | BUTTON.Left, BUTTON.Left]))
      .toBe('scared-fur');
  });

  it('throws the 623 special for a dragon punch', () => {
    const h = scared();
    expect(inputMotion(h, [BUTTON.Right, BUTTON.Down, BUTTON.Down | BUTTON.Right]))
      .toBe('scared-nine');
  });

  it('throws the function move for a double tap down', () => {
    const h = scared();
    expect(inputMotion(h, [BUTTON.Down, EMPTY_INPUT, BUTTON.Down])).toBe('scared-box');
  });

  it('falls back to the 236 special when no motion was input', () => {
    // The roster has to stay playable for someone who does not know any of the
    // motions, so a bare button is never a whiff.
    const h = scared();
    h.run(BUTTON.Special);
    expect(h.self.attack?.specId).toBe('scared-scream');
  });

  it('prefers the dragon punch over the quarter-circle it contains', () => {
    // A 623 passes through a forward and a down-forward, so a 236 read first
    // would mean the reversal could never come out.
    const h = scared();
    expect(inputMotion(h, [BUTTON.Right, BUTTON.Down, BUTTON.Down | BUTTON.Right]))
      .not.toBe('scared-scream');
  });

  it('mirrors the motion when the opponent is on the other side', () => {
    const h = harness({ configId: 'scared' }, 100); // opponent to the left
    h.run(EMPTY_INPUT); // let facing settle
    expect(inputMotion(h, [BUTTON.Down, BUTTON.Down | BUTTON.Left, BUTTON.Left]))
      .toBe('scared-scream');
  });

  it('gives a fighter without a 623 its quarter-back move for that motion', () => {
    // `alien` has no dragon punch; the input must not resolve to nothing.
    const h = harness({ configId: 'alien' });
    const specId = inputMotion(h, [BUTTON.Right, BUTTON.Down, BUTTON.Down | BUTTON.Right]);
    expect(specId).toBeTruthy();
    expect(specId).not.toBe('scared-nine');
  });
});

describe('the ultimate button', () => {
  it('fires the ultimate on its own button, with a full meter', () => {
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Ultimate);
    expect(h.self.state).toBe(FighterState.ULTIMATE);
    expect(h.self.energy).toBe(0);
  });

  it('still accepts the original down-plus-special motion', () => {
    // Kept so that hands trained on the trunk's controls keep working.
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Down | BUTTON.Special);
    expect(h.self.state).toBe(FighterState.ULTIMATE);
  });

  it('comes out as a special instead when the meter is short', () => {
    const h = harness({ energy: MAX_ENERGY - 1 });
    h.run(BUTTON.Ultimate);
    expect(h.self.state).toBe(FighterState.SPECIAL);
  });
});

describe('the universal throw', () => {
  it('comes out on its own button', () => {
    const h = harness();
    h.run(BUTTON.Throw);
    expect(h.self.state).toBe(FighterState.THROW);
    expect(h.self.attack?.specId).toBe('throw');
  });

  it('beats a light pressed on the same tick', () => {
    // A throw is what you reach for against someone who will not stop blocking;
    // losing the input to your own light would defeat the point.
    const h = harness();
    h.run(BUTTON.Throw | BUTTON.Light);
    expect(h.self.state).toBe(FighterState.THROW);
  });

  it('does not share the special cooldown', () => {
    // The two used to be gated by the same field, which meant a spent special
    // locked out the throw and vice versa.
    const h = harness();
    h.run(BUTTON.Special);
    expect(h.self.state).toBe(FighterState.SPECIAL);
    h.run(EMPTY_INPUT, 60); // let the special finish, cooldown still running
    expect(h.self.nextSpecialTick).toBeGreaterThan(h.tick);

    h.run(BUTTON.Throw);
    expect(h.self.state).toBe(FighterState.THROW);
  });

  it('cannot be started from the air', () => {
    const h = harness();
    h.run(BUTTON.Up);
    h.run(EMPTY_INPUT, 6);
    expect(h.self.y).toBeLessThan(GROUND_Y - 1);
    h.run(BUTTON.Throw);
    expect(h.self.state).not.toBe(FighterState.THROW);
  });

  it('fires once per press, not once per held tick', () => {
    const h = harness();
    h.run(BUTTON.Throw);
    h.run(BUTTON.Throw, 60);
    expect(h.self.state).toBe(FighterState.IDLE);
  });
});
