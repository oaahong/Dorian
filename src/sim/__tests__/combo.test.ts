import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../input';
import { MAX_ENERGY, P1_SPAWN_X } from '../constants';
import { IMPACT_SPEC, LIGHT_SPEC, PARRY_SPEC, RUSH_SPEC, getSpec } from '../attackSpecs';
import { createFighter, stepFighter } from '../fighter';
import { stepWorld, createWorld } from '../world';
import type { SimEvent, SimFighter } from '../types';

/**
 * Cancels, chords and dashes — the layer that turns a list of moves into combos.
 *
 * The distinction these tests are protecting is between a move that *connected*
 * and one that merely came out. A cancel is free frames, and free frames handed
 * out for whiffing would remove the only reason to respect anybody's turn.
 */

function harness(overrides: Partial<SimFighter> = {}, opponentX = 700) {
  const self = { ...createFighter('pink', P1_SPAWN_X, 1), ...overrides };
  const opponent = createFighter('ok', opponentX, -1);
  let tick = 0;
  return {
    self,
    opponent,
    get tick() {
      return tick;
    },
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

/** Put the fighter mid-light with the given result already recorded on it. */
function midLight(result: 'none' | 'hit' | 'block', energy = MAX_ENERGY) {
  const h = harness({ energy });
  h.run(BUTTON.Light);
  h.run(EMPTY_INPUT, LIGHT_SPEC.startupTicks + LIGHT_SPEC.activeTicks);
  h.self.attack!.result = result;
  return h;
}

describe('cancelling a normal', () => {
  it('lets a connected light cancel into a rush', () => {
    const h = midLight('hit');
    h.run(BUTTON.Light | BUTTON.Heavy);
    expect(h.self.state).toBe(FighterState.MEME_RUSH);
    expect(h.self.attack?.specId).toBe(RUSH_SPEC.id);
  });

  it('refuses the cancel when the light hit nothing', () => {
    const h = midLight('none');
    h.run(BUTTON.Light | BUTTON.Heavy);
    // Still the light, still in its own recovery, still punishable.
    expect(h.self.attack?.specId).toBe(LIGHT_SPEC.id);
  });

  /**
   * Lights cancel on block, heavies do not. That asymmetry is the whole reason
   * to open with a light: a blocked one keeps your turn, a blocked heavy hands it
   * over along with twenty-odd frames to punish it in.
   */
  it('lets a blocked light cancel but not a blocked heavy', () => {
    const light = midLight('block');
    light.run(BUTTON.Light | BUTTON.Heavy);
    expect(light.self.state).toBe(FighterState.MEME_RUSH);

    const heavy = harness({ energy: MAX_ENERGY });
    heavy.run(BUTTON.Heavy);
    heavy.run(EMPTY_INPUT, 10);
    heavy.self.attack!.result = 'block';
    heavy.run(BUTTON.Light | BUTTON.Heavy);
    expect(heavy.self.state).toBe(FighterState.HEAVY_ATTACK);
  });

  it('refuses the rush cancel without the meter for it', () => {
    const h = midLight('hit', RUSH_SPEC.meterCost - 1);
    h.run(BUTTON.Light | BUTTON.Heavy);
    expect(h.self.attack?.specId).toBe(LIGHT_SPEC.id);
  });

  it('charges for the rush exactly once', () => {
    const h = midLight('hit', MAX_ENERGY);
    h.run(BUTTON.Light | BUTTON.Heavy);
    expect(h.self.energy).toBe(MAX_ENERGY - RUSH_SPEC.meterCost);
  });

  it('cancels a connected light into a motion special', () => {
    const h = midLight('hit');
    // 236 rolled during the light's recovery, then the button.
    h.run(BUTTON.Down);
    h.run(BUTTON.Down | BUTTON.Right);
    h.run(BUTTON.Right);
    h.run(BUTTON.Right | BUTTON.Special);
    expect(h.self.state).toBe(FighterState.SPECIAL);
    expect(h.self.attack?.specId).toBe('pink-scream');
  });

  /**
   * A bare special during a cancel window would start a charge, and a charge is a
   * state the fighter cannot be interrupted out of by their own recovery — so it
   * has to be a *named* motion or nothing.
   */
  it('does not let a bare special press charge out of a cancel', () => {
    const h = midLight('hit');
    h.run(BUTTON.Special);
    expect(h.self.state).not.toBe(FighterState.H_CHARGING);
    expect(h.self.attack?.specId).toBe(LIGHT_SPEC.id);
  });

  /**
   * A chord may take back a move it has only just started, which is the only
   * reason a two-button input is reachable at all. The regression this guards is
   * the version that took the move back *whether or not anything replaced it* —
   * an unaffordable rush deleted the light and left the fighter in an attack
   * state with no attack running.
   */
  it('leaves the move intact when the chord that took it back went nowhere', () => {
    const h = harness({ energy: 0 });
    h.run(BUTTON.Light);
    h.run(BUTTON.Light | BUTTON.Heavy);
    expect(h.self.state).toBe(FighterState.LIGHT_ATTACK);
    expect(h.self.attack?.specId).toBe(LIGHT_SPEC.id);
  });

  it('lets the chord take back a move that has only just started', () => {
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Heavy);
    h.run(BUTTON.Heavy | BUTTON.Special);
    expect(h.self.state).toBe(FighterState.MEME_IMPACT);
  });

  it('refuses to take it back once the move is past its grace window', () => {
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Heavy);
    h.run(EMPTY_INPUT, 5);
    h.run(BUTTON.Heavy | BUTTON.Special);
    expect(h.self.state).toBe(FighterState.HEAVY_ATTACK);
  });

  it('leaves a charge running when the chord that interrupted it went nowhere', () => {
    const h = harness({ energy: 0 });
    h.run(BUTTON.Special);
    expect(h.self.state).toBe(FighterState.H_CHARGING);
    h.run(BUTTON.Special | BUTTON.Heavy);
    expect(h.self.state).toBe(FighterState.H_CHARGING);
    // The charge must keep counting rather than being reset by the near miss.
    expect(h.self.chargeTicks).toBeGreaterThan(0);
  });

  it('gives the cancelled-into move a clean result of its own', () => {
    const h = midLight('hit');
    h.run(BUTTON.Light | BUTTON.Heavy);
    expect(h.self.attack?.result).toBe('none');
  });
});

describe('the meme chords', () => {
  it('spends the meter up front, so a whiffed impact still costs', () => {
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Heavy | BUTTON.Special);
    expect(h.self.state).toBe(FighterState.MEME_IMPACT);
    expect(h.self.energy).toBe(MAX_ENERGY - IMPACT_SPEC.meterCost);
  });

  it('refuses an impact that cannot be paid for', () => {
    const h = harness({ energy: IMPACT_SPEC.meterCost - 1 });
    h.run(BUTTON.Heavy | BUTTON.Special);
    expect(h.self.state).toBe(FighterState.IDLE);
  });

  it('reads a chord whose halves land a couple of ticks apart', () => {
    // No hand presses two keys on the same tick. Without the leniency the near
    // miss would come out as the individual buttons instead of failing.
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Heavy);
    h.run(BUTTON.Heavy | BUTTON.Special);
    expect(h.self.state).toBe(FighterState.MEME_IMPACT);
  });

  it('puts the parry on cooldown and refuses a second one until it expires', () => {
    const h = harness({ energy: MAX_ENERGY });
    h.run(BUTTON.Light | BUTTON.Special);
    expect(h.self.state).toBe(FighterState.MEME_PARRY);

    // Wait out the move but not the cooldown.
    h.run(EMPTY_INPUT, 40);
    h.run(BUTTON.Light | BUTTON.Special);
    expect(h.self.state).not.toBe(FighterState.MEME_PARRY);

    h.run(EMPTY_INPUT, PARRY_SPEC.cooldownTicks);
    h.run(BUTTON.Light | BUTTON.Special);
    expect(h.self.state).toBe(FighterState.MEME_PARRY);
  });

  /**
   * The parry is expressed as three invulnerability windows rather than as a
   * mechanism of its own — which means it must cover strikes, projectiles and air
   * attacks, and must *not* cover throws. Throws are the answer to it, the same
   * way they are the answer to blocking.
   */
  it('is invulnerable to everything except a throw', () => {
    const covered = PARRY_SPEC.invulnerable.map((w) => w.against);
    expect(new Set(covered)).toEqual(new Set(['strike', 'projectile', 'airAttack']));
    expect(covered).not.toContain('throw');
    expect(covered).not.toContain('all');
  });
});

describe('dashes', () => {
  it('dashes forward on a double tap toward the opponent', () => {
    const h = harness();
    h.run(BUTTON.Right);
    h.run(EMPTY_INPUT);
    h.run(BUTTON.Right);
    expect(h.self.state).toBe(FighterState.DASH_FORWARD);
  });

  it('dashes back on a double tap away', () => {
    const h = harness();
    h.run(BUTTON.Left);
    h.run(EMPTY_INPUT);
    h.run(BUTTON.Left);
    expect(h.self.state).toBe(FighterState.DASH_BACK);
  });

  it('covers more ground than walking the same number of ticks', () => {
    const dash = harness();
    dash.run(BUTTON.Right);
    dash.run(EMPTY_INPUT);
    const dashStart = dash.self.x;
    dash.run(BUTTON.Right, 10);

    const walk = harness();
    walk.run(BUTTON.Right, 10);
    const walked = walk.self.x - P1_SPAWN_X;

    expect(dash.self.x - dashStart).toBeGreaterThan(walked);
  });

  it('returns to idle when the dash runs out', () => {
    const h = harness();
    h.run(BUTTON.Right);
    h.run(EMPTY_INPUT);
    h.run(BUTTON.Right);
    h.run(EMPTY_INPUT, 12);
    expect(h.self.state).toBe(FighterState.IDLE);
    expect(h.self.dashTicks).toBe(0);
  });

  /**
   * A dash is committed movement. Losing it to a jab would make it strictly
   * better than walking, since it would keep every option walking has and add
   * speed on top.
   */
  it('ignores buttons for its whole duration', () => {
    const h = harness();
    h.run(BUTTON.Right);
    h.run(EMPTY_INPUT);
    h.run(BUTTON.Right);
    h.run(BUTTON.Light, 5);
    expect(h.self.state).toBe(FighterState.DASH_FORWARD);
  });

  it('never eats an attack: a walk plus a button is still the button', () => {
    const h = harness();
    h.run(BUTTON.Right, 20);
    h.run(BUTTON.Right | BUTTON.Light);
    expect(h.self.state).toBe(FighterState.LIGHT_ATTACK);
  });
});

describe('determinism', () => {
  /**
   * Every mechanic added here reads the shared command history, and all of it has
   * to survive a resimulation of the same bytes — a chord recognised on one client
   * and missed on the other is a desync, not a dropped input.
   */
  it('reaches an identical checksum replaying the same combo inputs', () => {
    const script: InputFrame[] = [];
    for (let i = 0; i < 240; i += 1) {
      if (i % 40 === 0) script.push(BUTTON.Light);
      else if (i % 40 === 3) script.push(BUTTON.Light | BUTTON.Heavy);
      else if (i % 40 === 12) script.push(BUTTON.Right);
      else if (i % 40 === 14) script.push(BUTTON.Right);
      else if (i % 40 === 24) script.push(BUTTON.Heavy | BUTTON.Special);
      else script.push(EMPTY_INPUT);
    }

    const play = () => {
      const world = createWorld({ p1Character: 'pink', p2Character: 'ok', stage: 'stage-a', seed: 1 });
      const checksums: number[] = [];
      for (const frame of script) {
        stepWorld(world, [frame, EMPTY_INPUT]);
        checksums.push(world.fighters[0].x + world.fighters[0].energy);
      }
      return checksums;
    };

    expect(play()).toEqual(play());
  });
});

describe('the meme moves are registered', () => {
  it('resolves each by id, so a running one can find its own frame data', () => {
    for (const spec of [RUSH_SPEC, PARRY_SPEC, IMPACT_SPEC]) {
      expect(getSpec(spec.id)).toBe(spec);
    }
  });

  /** A rush that could touch anyone would be a free hit, not a free turn. */
  it('gives the rush no hitbox at all', () => {
    expect(RUSH_SPEC.reach).toBe(0);
    expect(RUSH_SPEC.damage).toBe(0);
  });
});

describe('a dash is a commitment', () => {
  /**
   * A back dash is performed by tapping away twice, which leaves the stick held
   * away — the same input that guards. Without this the dash would hand out a
   * free block on top of the movement, making it strictly better than walking
   * back and removing the read that is supposed to punish it.
   */
  it('does not guard during a back dash, even though away is still held', () => {
    const h = harness({}, 900);
    h.run(BUTTON.Left);
    h.run(EMPTY_INPUT);
    h.run(BUTTON.Left);
    expect(h.self.state).toBe(FighterState.DASH_BACK);
    h.run(BUTTON.Left, 3);
    expect(h.self.guardHeld).toBe(false);
  });

  it('guards again once the dash is over', () => {
    const h = harness({}, 900);
    h.run(BUTTON.Left);
    h.run(EMPTY_INPUT);
    h.run(BUTTON.Left);
    h.run(BUTTON.Left, 12);
    expect(h.self.guardHeld).toBe(true);
  });
});
