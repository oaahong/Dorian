import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../input';
import { BLOCK_STANCE_RANGE, INPUT_BUFFER_TICKS, MAX_ENERGY, P1_SPAWN_X, msToTicks } from '../constants';
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
  const self = { ...createFighter('collapse', P1_SPAWN_X, 1), ...overrides };
  const opponent = createFighter('okboss', opponentX, -1);
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
     * cooldowns differ per character (awkward 1800 ms, collapse 1500 ms) and
     * dominate the control-stat term, so a cross-fighter comparison would say
     * nothing about the scaling.
     *
     * Special cooldowns use `1.08 - stat * 0.025`, distinct from the `1.05`
     * curve that scales attack recovery. See docs/sim-spec.md §1.
     */
    const h = harness({ configId: 'awkward' }); // controlStat 5, cooldown 1800 ms
    h.run(BUTTON.Special);
    const cooldownTicks = msToTicks(1800);
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
