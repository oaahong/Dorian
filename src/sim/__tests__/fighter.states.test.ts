import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../input';
import { GROUND_Y, P1_SPAWN_X, P2_SPAWN_X } from '../constants';
import { HEAVY_SPEC, JUMP_LIGHT_SPEC, LIGHT_SPEC } from '../attackSpecs';
import { attackActive, createFighter, stepFighter } from '../fighter';
import type { SimEvent, SimFighter } from '../types';

/**
 * The per-fighter state machine, ported from Fighter.update / processIntent.
 * See docs/sim-spec.md §3. Branch order is load-bearing: an attack in progress
 * beats stun, which beats input, so the tests exercise the order and not just the
 * individual transitions.
 */

interface Harness {
  self: SimFighter;
  opponent: SimFighter;
  events: SimEvent[];
  tick: number;
  /** Advance `ticks` steps holding `input`, and return the events emitted. */
  run(input?: InputFrame, ticks?: number, inputEnabled?: boolean): SimEvent[];
}

function harness(overrides: Partial<SimFighter> = {}, opponentX = P2_SPAWN_X): Harness {
  const self = { ...createFighter('pink', P1_SPAWN_X, 1), ...overrides };
  const opponent = createFighter('ok', opponentX, -1);
  const h: Harness = {
    self,
    opponent,
    events: [],
    tick: 0,
    run(input = EMPTY_INPUT, ticks = 1, inputEnabled = true) {
      const emitted: SimEvent[] = [];
      for (let i = 0; i < ticks; i += 1) {
        stepFighter(self, opponent, input, h.tick, inputEnabled, 0, emitted);
        h.tick += 1;
      }
      h.events.push(...emitted);
      return emitted;
    },
  };
  return h;
}

// 'pink' has controlStat 2, so CONTROL_RECOVERY_MULTIPLIER is exactly 1.0 and
// attack durations are the raw spec values. That keeps the arithmetic legible.
const LIGHT_TOTAL = LIGHT_SPEC.startupTicks + LIGHT_SPEC.activeTicks + LIGHT_SPEC.recoveryTicks;
const JUMP_LIGHT_TOTAL =
  JUMP_LIGHT_SPEC.startupTicks + JUMP_LIGHT_SPEC.activeTicks + JUMP_LIGHT_SPEC.recoveryTicks;

describe('facing', () => {
  it('turns to face the opponent every tick', () => {
    const h = harness({ x: 900 }, 300);
    h.run();
    expect(h.self.facing).toBe(-1);

    h.opponent.x = 1100;
    h.run();
    expect(h.self.facing).toBe(1);
  });

  it('treats an exactly equal position as facing right', () => {
    const h = harness({ x: 500 }, 500);
    h.run();
    expect(h.self.facing).toBe(1);
  });

  it('freezes facing once knocked out', () => {
    const h = harness({ x: 900, facing: 1, state: FighterState.KO }, 300);
    h.run();
    expect(h.self.facing).toBe(1);
  });
});

describe('idle and walking', () => {
  it('stands still with no input', () => {
    const h = harness();
    h.run();
    expect(h.self.state).toBe(FighterState.IDLE);
    expect(h.self.vx).toBe(0);
    expect(h.self.x).toBe(P1_SPAWN_X);
  });

  it('walks toward the opponent at the speed-stat rate', () => {
    const h = harness();
    h.run(BUTTON.Right);
    expect(h.self.state).toBe(FighterState.WALK);
    // 'pink' has speedStat 3 -> 280 px/s.
    expect(h.self.vx).toBe(280);
    expect(h.self.x).toBeGreaterThan(P1_SPAWN_X);
  });

  it('crouches and stops moving', () => {
    const h = harness();
    h.run(BUTTON.Down);
    expect(h.self.state).toBe(FighterState.CROUCH);
    expect(h.self.vx).toBe(0);
  });

  it('cancels movement when both directions are held', () => {
    const h = harness();
    h.run(BUTTON.Left | BUTTON.Right);
    expect(h.self.state).toBe(FighterState.IDLE);
    expect(h.self.vx).toBe(0);
  });
});

describe('jumping', () => {
  it('leaves the ground on the rising edge of up', () => {
    const h = harness();
    const events = h.run(BUTTON.Up);
    expect(h.self.state).toBe(FighterState.JUMP);
    expect(h.self.y).toBeLessThan(GROUND_Y);
    expect(events).toContainEqual({ t: 'jump', player: 0 });
  });

  it('does not re-trigger while up is held', () => {
    const h = harness();
    h.run(BUTTON.Up);
    const events = h.run(BUTTON.Up, 20);
    expect(events.filter((e) => e.t === 'jump')).toHaveLength(0);
  });

  it('gives reduced horizontal control in the air', () => {
    const h = harness();
    h.run(BUTTON.Up);
    h.run(BUTTON.Up | BUTTON.Right);
    // 280 px/s * 0.75 air control.
    expect(h.self.vx).toBeCloseTo(280 * 0.75, 10);
  });

  it('returns to idle after landing', () => {
    const h = harness();
    h.run(BUTTON.Up);
    h.run(EMPTY_INPUT, 60);
    expect(h.self.state).toBe(FighterState.IDLE);
    expect(h.self.y).toBe(GROUND_Y);
  });
});

describe('attack lifecycle', () => {
  it('does not advance the attack on the tick it starts', () => {
    const h = harness();
    h.run(BUTTON.Light);
    expect(h.self.state).toBe(FighterState.LIGHT_ATTACK);
    expect(h.self.attack?.elapsedTicks).toBe(0);
    expect(attackActive(h.self)).toBe(false);
  });

  it('stops the fighter dead when a grounded attack starts', () => {
    const h = harness({ vx: 310, state: FighterState.WALK });
    h.run(BUTTON.Right | BUTTON.Light);
    expect(h.self.vx).toBe(0);
  });

  it('becomes active exactly at the startup boundary', () => {
    const h = harness();
    h.run(BUTTON.Light);

    h.run(EMPTY_INPUT, LIGHT_SPEC.startupTicks - 1);
    expect(attackActive(h.self)).toBe(false);

    h.run();
    expect(h.self.attack?.elapsedTicks).toBe(LIGHT_SPEC.startupTicks);
    expect(attackActive(h.self)).toBe(true);
  });

  it('reports the tick the active window opens, once', () => {
    const h = harness();
    h.run(BUTTON.Light);
    h.run(EMPTY_INPUT, LIGHT_SPEC.startupTicks - 1);
    expect(h.self.attack?.activeJustStarted).toBe(false);

    h.run();
    expect(h.self.attack?.activeJustStarted).toBe(true);

    h.run();
    expect(h.self.attack?.activeJustStarted).toBe(false);
  });

  it('closes the active window after activeTicks', () => {
    const h = harness();
    h.run(BUTTON.Light);

    // The window is [startup, startup + active), so the last active tick is one
    // before the sum.
    h.run(EMPTY_INPUT, LIGHT_SPEC.startupTicks + LIGHT_SPEC.activeTicks - 1);
    expect(attackActive(h.self)).toBe(true);

    h.run();
    expect(attackActive(h.self)).toBe(false);
  });

  it('returns to idle after startup + active + recovery', () => {
    const h = harness();
    h.run(BUTTON.Light);

    h.run(EMPTY_INPUT, LIGHT_TOTAL - 1);
    expect(h.self.attack).not.toBeNull();

    h.run();
    expect(h.self.attack).toBeNull();
    expect(h.self.state).toBe(FighterState.IDLE);
  });

  it('ignores new input for the whole duration of an attack', () => {
    const h = harness();
    h.run(BUTTON.Light);
    // Mashing every button must not interrupt the attack in progress.
    h.run(BUTTON.Right | BUTTON.Up | BUTTON.Heavy, LIGHT_TOTAL - 2);
    expect(h.self.state).toBe(FighterState.LIGHT_ATTACK);
  });

  it('scales recovery by the control stat', () => {
    /**
     * 'ok' has controlStat 5 (multiplier 0.925), 'pink' has 2 (1.0),
     * measured on the identical shared HEAVY normal.
     *
     * HEAVY is used rather than LIGHT deliberately: LIGHT's totals are 19.25 vs
     * 20 ticks, which both land on integer tick 20, so the difference is
     * invisible. HEAVY gives 34.65 vs 36 — awkward clears on tick 35, collapse
     * needs 36. Recovery scaling is only observable where it crosses a tick.
     */
    const fast = harness({ configId: 'ok' });
    const slow = harness({ configId: 'pink' });
    fast.run(BUTTON.Heavy);
    slow.run(BUTTON.Heavy);

    const HEAVY_TOTAL = HEAVY_SPEC.startupTicks + HEAVY_SPEC.activeTicks + HEAVY_SPEC.recoveryTicks;
    fast.run(EMPTY_INPUT, HEAVY_TOTAL - 1);
    slow.run(EMPTY_INPUT, HEAVY_TOTAL - 1);

    expect(fast.self.attack).toBeNull();
    expect(slow.self.attack).not.toBeNull();
  });

  it('lands in JUMP rather than IDLE if the attack ends mid-air', () => {
    const h = harness();
    h.run(BUTTON.Up);
    h.run(BUTTON.Light);
    expect(h.self.attack?.airborne).toBe(true);
    // The air light is its own move now, and a longer one — six active frames
    // rather than two, because it has to survive the arc it is thrown from.
    expect(h.self.attack?.specId).toBe(JUMP_LIGHT_SPEC.id);
    h.run(EMPTY_INPUT, JUMP_LIGHT_TOTAL);
    expect(h.self.attack).toBeNull();
    expect(h.self.state).toBe(FighterState.JUMP);
  });

  it('emits an attack-start event carrying the spec that began', () => {
    const h = harness();
    const events = h.run(BUTTON.Heavy);
    expect(events).toContainEqual({
      t: 'attackStart',
      player: 0,
      specId: HEAVY_SPEC.id,
      state: FighterState.HEAVY_ATTACK,
    });
  });
});

describe('attack motion', () => {
  it('drags a dash attack forward only during its active frames', () => {
    // 'ok' leads with OK衝刺, a dashStrike — the kind that drives itself forward.
    // It needs its 236 now, since a bare button winds up the chargeable special.
    const h = harness({ configId: 'ok', x: 400 }, 900);
    h.run(BUTTON.Down);
    h.run(BUTTON.Down | BUTTON.Right);
    h.run(BUTTON.Right);
    h.run(BUTTON.Special);
    const spec = h.self.attack!;
    expect(spec.kind).toBe('dashStrike');
    // Measured from where the motion left the fighter, not from its spawn: walking
    // the 236 in moves it a few pixels first.
    const atStart = h.self.x;

    h.run(EMPTY_INPUT, LIGHT_SPEC.startupTicks); // still in startup for this spec
    expect(h.self.x).toBe(atStart);

    h.run(EMPTY_INPUT, 12);
    expect(h.self.x).toBeGreaterThan(atStart);
  });

  it('drifts a heavy attack forward during its active frames', () => {
    const h = harness({ x: 400 }, 900);
    h.run(BUTTON.Heavy);
    h.run(EMPTY_INPUT, HEAVY_SPEC.startupTicks + 1);
    expect(h.self.x).toBeGreaterThan(400);
  });
});

describe('stun', () => {
  it('counts hitstun down and releases to idle', () => {
    const h = harness({ state: FighterState.HITSTUN, stateRemainingTicks: 3 });
    h.run(BUTTON.Right, 2);
    expect(h.self.state).toBe(FighterState.HITSTUN);

    h.run(BUTTON.Right);
    expect(h.self.state).toBe(FighterState.IDLE);
  });

  it('ignores input entirely while stunned', () => {
    const h = harness({ state: FighterState.HITSTUN, stateRemainingTicks: 10 });
    h.run(BUTTON.Light | BUTTON.Up, 5);
    expect(h.self.state).toBe(FighterState.HITSTUN);
    expect(h.self.attack).toBeNull();
  });

  it('releases an airborne fighter into JUMP rather than IDLE', () => {
    const h = harness({
      state: FighterState.HITSTUN,
      stateRemainingTicks: 1,
      y: GROUND_Y - 150,
      vy: -100,
    });
    h.run();
    expect(h.self.state).toBe(FighterState.JUMP);
  });
});

describe('round-end states', () => {
  it.each([FighterState.KO, FighterState.VICTORY])('freezes input in %s', (state) => {
    const h = harness({ state });
    h.run(BUTTON.Right | BUTTON.Light | BUTTON.Up, 10);
    expect(h.self.state).toBe(state);
    expect(h.self.attack).toBeNull();
  });
});

describe('input disabled (intro and round end)', () => {
  it('halts a walking fighter', () => {
    const h = harness({ vx: 310, state: FighterState.WALK });
    h.run(BUTTON.Right, 1, false);
    expect(h.self.vx).toBe(0);
    expect(h.self.state).toBe(FighterState.IDLE);
  });

  it('leaves a crouching fighter crouched', () => {
    const h = harness({ state: FighterState.CROUCH });
    h.run(EMPTY_INPUT, 1, false);
    expect(h.self.state).toBe(FighterState.CROUCH);
  });

  it('never sets guardHeld', () => {
    const h = harness({ x: 400 }, 600);
    h.run(BUTTON.Left, 1, false);
    expect(h.self.guardHeld).toBe(false);
  });
});
