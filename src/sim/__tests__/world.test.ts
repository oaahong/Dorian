import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import {
  ARENA_MAX_X,
  ENDING_TICKS,
  GAME_WIDTH,
  GROUND_Y,
  INTRO_TICKS,
  P1_SPAWN_X,
  P2_SPAWN_X,
  PUSH_APART_DISTANCE,
  ROUND_CALL_TICKS,
  ROUND_TICKS,
  ROUNDS_TO_WIN,
  MAX_ENERGY,
} from '../constants';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../input';
import { ultimateDefinitionFor } from '../../fighters/ultimateDefinitions';
import { ultimateTimelineFor } from '../../fighters/ultimateTimelines';
import { getSpec } from '../attackSpecs';
import { createWorld, checksum, stepWorld, type MatchSetup } from '../world';
import type { SimEvent, SimWorld } from '../types';

/** Round and match flow, ported from BattleScene. See docs/gameplay/sim-spec.md §9. */

const SETUP: MatchSetup = {
  seed: 20260815,
  p1Character: 'pink',
  p2Character: 'ok',
  stage: 'freezer',
};

const world = (setup: Partial<MatchSetup> = {}): SimWorld => createWorld({ ...SETUP, ...setup });

/** Advance `ticks`, collecting every event emitted. */
function run(w: SimWorld, ticks: number, p1: InputFrame = EMPTY_INPUT, p2: InputFrame = EMPTY_INPUT): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i += 1) events.push(...stepWorld(w, [p1, p2]));
  return events;
}

/** Skip the round intro so a test can act on the first fight tick. */
function toFight(w: SimWorld): SimWorld {
  run(w, INTRO_TICKS);
  return w;
}

describe('createWorld', () => {
  it('starts both fighters at their spawns, facing each other', () => {
    const w = world();
    expect(w.fighters[0].x).toBe(P1_SPAWN_X);
    expect(w.fighters[0].facing).toBe(1);
    expect(w.fighters[1].x).toBe(P2_SPAWN_X);
    expect(w.fighters[1].facing).toBe(-1);
    expect(w.fighters[0].y).toBe(GROUND_Y);
  });

  it('opens on round one in the intro phase with a full clock', () => {
    const w = world();
    expect(w.phase).toBe('intro');
    expect(w.roundNumber).toBe(1);
    expect(w.roundTicksRemaining).toBe(ROUND_TICKS);
    expect(w.roundWins).toEqual([0, 0]);
    expect(w.matchWinner).toBeNull();
    expect(w.tick).toBe(0);
  });

  it('carries the characters and stage chosen by the host', () => {
    const w = world({ p1Character: 'alien', p2Character: 'wizard', stage: 'magicForest' });
    expect(w.fighters[0].configId).toBe('alien');
    expect(w.fighters[1].configId).toBe('wizard');
    expect(w.stage).toBe('magicForest');
  });
});

describe('round intro', () => {
  it('announces the round and then the fight call', () => {
    const w = world();
    const early = run(w, 1);
    expect(early).toContainEqual({ t: 'roundStart', round: 1 });

    const events = run(w, ROUND_CALL_TICKS);
    expect(events).toContainEqual({ t: 'announce', text: 'CAT FIGHT!' });
  });

  it('hands over control exactly at INTRO_TICKS', () => {
    const w = world();
    run(w, INTRO_TICKS - 1);
    expect(w.phase).toBe('intro');

    run(w, 1);
    expect(w.phase).toBe('fight');
  });

  it('ignores input during the intro', () => {
    const w = world();
    run(w, INTRO_TICKS - 1, BUTTON.Right | BUTTON.Light);
    expect(w.fighters[0].x).toBe(P1_SPAWN_X);
    expect(w.fighters[0].state).toBe(FighterState.IDLE);
  });

  it('does not run the round clock during the intro', () => {
    const w = world();
    run(w, INTRO_TICKS - 1);
    expect(w.roundTicksRemaining).toBe(ROUND_TICKS);
  });
});

describe('the fight', () => {
  it('runs the round clock down one tick at a time', () => {
    const w = toFight(world());
    run(w, 10);
    expect(w.roundTicksRemaining).toBe(ROUND_TICKS - 10);
  });

  it('accepts input once the fight starts', () => {
    const w = toFight(world());
    run(w, 5, BUTTON.Right);
    expect(w.fighters[0].x).toBeGreaterThan(P1_SPAWN_X);
    expect(w.fighters[0].state).toBe(FighterState.WALK);
  });

  it('drives the two fighters independently', () => {
    const w = toFight(world());
    run(w, 5, BUTTON.Right, BUTTON.Left);
    expect(w.fighters[0].x).toBeGreaterThan(P1_SPAWN_X);
    expect(w.fighters[1].x).toBeLessThan(P2_SPAWN_X);
  });
});

describe('push-apart', () => {
  it('separates two overlapping grounded fighters', () => {
    const w = toFight(world());
    w.fighters[0].x = 600;
    w.fighters[1].x = 640;
    run(w, 1);
    expect(Math.abs(w.fighters[1].x - w.fighters[0].x)).toBeCloseTo(PUSH_APART_DISTANCE, 6);
  });

  it('leaves fighters further apart than the push distance alone', () => {
    const w = toFight(world());
    w.fighters[0].x = 400;
    w.fighters[1].x = 900;
    run(w, 1);
    expect(w.fighters[0].x).toBe(400);
    expect(w.fighters[1].x).toBe(900);
  });

  it('does not separate fighters while either is airborne', () => {
    const w = toFight(world());
    w.fighters[0].x = 600;
    w.fighters[1].x = 640;
    w.fighters[1].y = GROUND_Y - 150;
    run(w, 1);
    expect(Math.abs(w.fighters[1].x - w.fighters[0].x)).toBeLessThan(PUSH_APART_DISTANCE);
  });

  it('never pushes a fighter out of the arena', () => {
    const w = toFight(world());
    w.fighters[0].x = ARENA_MAX_X - 10;
    w.fighters[1].x = ARENA_MAX_X;
    run(w, 1);
    expect(w.fighters[1].x).toBeLessThanOrEqual(ARENA_MAX_X);
  });
});

describe('hit-stop', () => {
  it('freezes the whole simulation, including the clock', () => {
    const w = toFight(world());
    w.hitStopTicks = 4;
    const before = { x: w.fighters[0].x, clock: w.roundTicksRemaining };

    run(w, 3, BUTTON.Right);

    expect(w.fighters[0].x).toBe(before.x);
    expect(w.roundTicksRemaining).toBe(before.clock);
    expect(w.hitStopTicks).toBe(1);
  });

  it('resumes once the freeze expires', () => {
    const w = toFight(world());
    w.hitStopTicks = 2;
    run(w, 3, BUTTON.Right);
    expect(w.fighters[0].x).toBeGreaterThan(P1_SPAWN_X);
  });

  it('is applied when an attack connects', () => {
    const w = toFight(world());
    w.fighters[0].x = 600;
    w.fighters[1].x = 660;
    run(w, 1, BUTTON.Light);
    run(w, 6, BUTTON.Light);
    expect(w.hitStopTicks).toBeGreaterThan(0);
  });
});

describe('round end by knockout', () => {
  const knockOut = (w: SimWorld, loser: 0 | 1) => {
    w.fighters[loser].hp = 0;
  };

  it('ends the round and credits the winner', () => {
    const w = toFight(world());
    knockOut(w, 1);
    const events = run(w, 1);

    expect(w.phase).toBe('ending');
    expect(w.roundWins).toEqual([1, 0]);
    expect(events).toContainEqual(expect.objectContaining({ t: 'roundEnd', winner: 1, reason: 'KO' }));
  });

  it('puts the winner in victory', () => {
    const w = toFight(world());
    knockOut(w, 1);
    run(w, 1);
    expect(w.fighters[0].state).toBe(FighterState.VICTORY);
  });

  it('leaves a genuinely knocked-out loser in KO', () => {
    /**
     * Driven through a real hit rather than by zeroing hp directly: on a KO the
     * loser's KO state comes from receiveImpact, and endRound deliberately does
     * not re-apply it. Setting hp to 0 by hand skips that and would leave the
     * loser idle — which is exactly what this test would have missed.
     */
    const w = toFight(world());
    w.fighters[0].x = 600;
    w.fighters[1].x = 660;
    w.fighters[1].hp = 0.5;

    run(w, 1, BUTTON.Light);
    run(w, 20);

    expect(w.fighters[1].state).toBe(FighterState.KO);
    expect(w.fighters[1].hp).toBe(0);
    expect(w.roundWins).toEqual([1, 0]);
  });

  it('scores a double knockout as a draw', () => {
    const w = toFight(world());
    knockOut(w, 0);
    knockOut(w, 1);
    run(w, 1);
    expect(w.roundWins).toEqual([0, 0]);
  });

  it('starts the next round after the ending delay', () => {
    const w = toFight(world());
    knockOut(w, 1);
    run(w, 1);

    run(w, ENDING_TICKS - 1);
    expect(w.phase).toBe('ending');

    run(w, 1);
    expect(w.phase).toBe('intro');
    expect(w.roundNumber).toBe(2);
    expect(w.roundTicksRemaining).toBe(ROUND_TICKS);
    expect(w.fighters[0].hp).toBe(100);
    expect(w.fighters[0].x).toBe(P1_SPAWN_X);
  });

  it('keeps the round wins across rounds', () => {
    const w = toFight(world());
    w.fighters[1].hp = 0;
    run(w, 1 + ENDING_TICKS);
    expect(w.roundWins).toEqual([1, 0]);
  });
});

describe('round end by timeout', () => {
  it('gives the round to whoever has more health', () => {
    const w = toFight(world());
    w.roundTicksRemaining = 1;
    w.fighters[0].hp = 60;
    w.fighters[1].hp = 30;
    const events = run(w, 1);

    expect(w.roundWins).toEqual([1, 0]);
    expect(events).toContainEqual(expect.objectContaining({ t: 'roundEnd', reason: 'TIME' }));
  });

  it('forces the loser into a knockout even without a killing blow', () => {
    const w = toFight(world());
    w.roundTicksRemaining = 1;
    w.fighters[0].hp = 60;
    w.fighters[1].hp = 30;
    run(w, 1);
    expect(w.fighters[1].state).toBe(FighterState.KO);
    expect(w.fighters[1].hp).toBe(30);
  });

  it('calls a draw when health is within a hundredth of a point', () => {
    const w = toFight(world());
    w.roundTicksRemaining = 1;
    w.fighters[0].hp = 50;
    w.fighters[1].hp = 50.005;
    run(w, 1);
    expect(w.roundWins).toEqual([0, 0]);
  });

  it('leaves neither fighter in victory on a draw', () => {
    const w = toFight(world());
    w.roundTicksRemaining = 1;
    run(w, 1);
    expect(w.fighters[0].state).not.toBe(FighterState.VICTORY);
    expect(w.fighters[1].state).not.toBe(FighterState.VICTORY);
  });
});

describe('match end', () => {
  const winRound = (w: SimWorld, loser: 0 | 1) => {
    w.fighters[loser].hp = 0;
    run(w, 1 + ENDING_TICKS);
  };

  it('ends the match at two round wins', () => {
    const w = toFight(world());
    winRound(w, 1);
    toFight(w);
    w.fighters[1].hp = 0;
    run(w, 1);

    expect(w.roundWins).toEqual([ROUNDS_TO_WIN, 0]);
    run(w, ENDING_TICKS);
    expect(w.matchWinner).toBe(0);
  });

  it('does not start another round once the match is decided', () => {
    const w = toFight(world());
    winRound(w, 1);
    toFight(w);
    w.fighters[1].hp = 0;
    run(w, 1 + ENDING_TICKS + 60);
    expect(w.roundNumber).toBe(2);
    expect(w.phase).toBe('ending');
  });

  it('goes to a third round when the players split the first two', () => {
    const w = toFight(world());
    winRound(w, 1);
    toFight(w);
    winRound(w, 0);

    expect(w.roundWins).toEqual([1, 1]);
    expect(w.roundNumber).toBe(3);
    expect(w.matchWinner).toBeNull();
  });
});

describe('projectiles', () => {
  /**
   * 'pink' throws a `sonic` projectile on its 236, so the motion has to be input
   * — a bare button now winds up the chargeable special instead, which for this
   * fighter is a beam and spawns nothing.
   */
  const fireSpecial = (w: SimWorld) => {
    run(w, 1, BUTTON.Down);
    run(w, 1, BUTTON.Down | BUTTON.Right);
    run(w, 1, BUTTON.Right);
    run(w, 1, BUTTON.Special);
    run(w, 12);
  };

  it('spawns one on the tick the attack becomes active', () => {
    const w = toFight(world({ p1Character: 'pink' }));
    expect(w.projectiles).toHaveLength(0);
    fireSpecial(w);
    expect(w.projectiles).toHaveLength(1);
    expect(w.projectiles[0]!.ownerIndex).toBe(0);
  });

  it('travels in the owner’s facing direction', () => {
    const w = toFight(world({ p1Character: 'pink' }));
    fireSpecial(w);
    const startX = w.projectiles[0]!.x;
    run(w, 5);
    expect(w.projectiles[0]!.x).toBeGreaterThan(startX);
  });

  it('damages the opponent and despawns on contact', () => {
    const w = toFight(world({ p1Character: 'pink' }));
    w.fighters[1].x = 700;
    fireSpecial(w);
    run(w, 40);
    expect(w.fighters[1].hp).toBeLessThan(100);
    expect(w.projectiles).toHaveLength(0);
  });

  it('cannot hit the same target twice', () => {
    const w = toFight(world({ p1Character: 'pink' }));
    w.fighters[1].x = 700;
    fireSpecial(w);
    run(w, 40);
    const hpAfterFirst = w.fighters[1].hp;
    run(w, 40);
    expect(w.fighters[1].hp).toBe(hpAfterFirst);
  });

  it('expires once its lifetime runs out', () => {
    const w = toFight(world({ p1Character: 'pink' }));
    w.fighters[1].x = ARENA_MAX_X;
    fireSpecial(w);
    run(w, 120);
    expect(w.projectiles).toHaveLength(0);
  });

  it('despawns after leaving the screen', () => {
    const w = toFight(world({ p1Character: 'pink' }));
    fireSpecial(w);
    w.projectiles[0]!.x = GAME_WIDTH + 200;
    run(w, 1);
    expect(w.projectiles).toHaveLength(0);
  });

  it('is cleared when a new round begins', () => {
    const w = toFight(world({ p1Character: 'pink' }));
    fireSpecial(w);
    expect(w.projectiles.length).toBeGreaterThan(0);
    w.fighters[1].hp = 0;
    run(w, 1 + ENDING_TICKS);
    expect(w.projectiles).toHaveLength(0);
  });
});

describe('the universal throw', () => {
  /**
   * The throw exists to answer a fighter who simply holds back and blocks, so the
   * behaviour worth testing at world level is exactly that: two fighters in range,
   * one blocking, one throwing.
   */
  const inRange = (w: SimWorld) => {
    w.fighters[0].x = 600;
    w.fighters[1].x = 660;
    return w;
  };

  it('lands on an opponent who is holding block', () => {
    const w = inRange(toFight(world()));
    // P2 holds away from P1, which is the block stance.
    run(w, 20, BUTTON.Throw, BUTTON.Right);
    expect(w.fighters[1].hp).toBeLessThan(100);
    expect(w.fighters[1].state).toBe(FighterState.HITSTUN);
  });

  it('leaves a blocked light doing almost nothing by comparison', () => {
    const blocked = inRange(toFight(world()));
    run(blocked, 20, BUTTON.Light, BUTTON.Right);

    const thrown = inRange(toFight(world()));
    run(thrown, 20, BUTTON.Throw, BUTTON.Right);

    expect(thrown.fighters[1].hp).toBeLessThan(blocked.fighters[1].hp);
  });

  it('whiffs against an opponent who jumps', () => {
    const w = inRange(toFight(world()));
    run(w, 4, EMPTY_INPUT, BUTTON.Up); // P2 leaves the ground first
    run(w, 16, BUTTON.Throw);
    expect(w.fighters[1].hp).toBe(100);
  });

  it('whiffs at a range a heavy would still reach', () => {
    // Reach is the throw's price for being unblockable: 76 against the heavy's
    // 104. Light is 78, so the throw is only meaningfully shorter than the heavy —
    // which is the spacing this pins down.
    const far = (w: SimWorld) => {
      w.fighters[0].x = 600;
      w.fighters[1].x = 780;
      return w;
    };

    const thrown = far(toFight(world()));
    run(thrown, 24, BUTTON.Throw);
    expect(thrown.fighters[1].hp).toBe(100);

    const swung = far(toFight(world()));
    run(swung, 24, BUTTON.Heavy);
    expect(swung.fighters[1].hp).toBeLessThan(100);
  });
});

describe('zones', () => {
  // 'wizard' has a `zone` special.
  it('waits out its telegraph before it can hit', () => {
    const w = toFight(world({ p1Character: 'wizard' }));
    run(w, 1, BUTTON.Special);
    run(w, 22); // past the 18-tick startup, well inside the 24-tick telegraph
    expect(w.zones).toHaveLength(1);
    expect(w.zones[0]!.triggered).toBe(false);
    expect(w.fighters[1].hp).toBe(100);
  });

  it('triggers and damages a target standing in it', () => {
    const w = toFight(world({ p1Character: 'wizard' }));
    w.fighters[1].x = 700;
    run(w, 1, BUTTON.Special);
    run(w, 60);
    expect(w.fighters[1].hp).toBeLessThan(100);
  });

  it('misses a target that walks out of it', () => {
    const w = toFight(world({ p1Character: 'wizard' }));
    w.fighters[1].x = 700;
    run(w, 1, BUTTON.Special);
    run(w, 22);
    w.fighters[1].x = ARENA_MAX_X;
    run(w, 60);
    expect(w.fighters[1].hp).toBe(100);
  });
});

describe('ultimates', () => {
  /**
   * Each ultimate kind resolves through a different path — a wide box, a
   * screen-wide hit with no geometry at all, or a delayed ground zone. They are
   * the least-exercised code in the simulation and the most spectacular when they
   * break, so each family gets a case.
   */
  /**
   * Fire the ultimate and run past its cut-in.
   *
   * The simulation freezes itself for the whole cut-in — 87 ticks and up — so a
   * fixed number of ticks afterwards is mostly spent frozen. This waits the freeze
   * out and then gives the move `ticks` to resolve.
   */
  const fireUltimate = (w: SimWorld, ticks = 90) => {
    w.fighters[0].energy = MAX_ENERGY;
    run(w, 1, BUTTON.Ultimate);
    while (w.hitStopTicks > 0) run(w, 1);
    run(w, ticks);
  };

  it('announces itself once and freezes the action', () => {
    const w = toFight(world({ p1Character: 'pink' }));
    w.fighters[0].energy = MAX_ENERGY;
    const events = run(w, 1, BUTTON.Ultimate);
    expect(events).toContainEqual(
      expect.objectContaining({ t: 'ultimateStart', player: 0 }),
    );
    expect(w.hitStopTicks).toBeGreaterThan(0);

    // The presentation must not repeat every tick of the attack.
    const later = run(w, 60);
    expect(later.filter((e) => e.t === 'ultimateStart')).toHaveLength(0);
  });

  it('freezes for exactly as long as the cut-in the view will play', () => {
    /**
     * The load-bearing invariant of the whole cut-in. The presentation is the
     * render layer's business, but its length is the simulation's: a pause that
     * only stopped drawing would let two clients disagree about how far the match
     * had advanced. So the freeze comes from the ultimate's own definition, and
     * both sides read the same number.
     */
    const w = toFight(world({ p1Character: 'pink' }));
    w.fighters[0].energy = MAX_ENERGY;
    run(w, 1, BUTTON.Ultimate);
    expect(w.hitStopTicks).toBe(ultimateDefinitionFor('pink').cutInTicks);
  });

  it('holds the round clock still for the whole cut-in', () => {
    // Freezing the action but not the timer would let a cornered player spend a
    // second of someone else's clock by firing an ultimate.
    const w = toFight(world({ p1Character: 'pink' }));
    w.fighters[0].energy = MAX_ENERGY;
    run(w, 1, BUTTON.Ultimate);
    const clock = w.roundTicksRemaining;
    run(w, ultimateDefinitionFor('pink').cutInTicks - 1);
    expect(w.roundTicksRemaining).toBe(clock);
  });

  it('lands a wide-box ultimate', () => {
    // 'doge' has ultimate-sonic: a tall box in front of the attacker.
    const w = toFight(world({ p1Character: 'doge' }));
    w.fighters[1].x = 800;
    fireUltimate(w);
    expect(w.fighters[1].hp).toBeLessThan(100);
  });

  /**
   * Reach no longer decides an ultimate — the timeline does. doge's is a
   * transformation whose one screen-wide burst covers the arena, so the wall-to-
   * wall case that used to fall short now connects, and the thing worth asserting
   * is the transformation rather than the distance.
   */
  it('lands a transformation ultimate from across the arena, and transforms', () => {
    const w = toFight(world({ p1Character: 'doge' }));
    w.fighters[0].x = 1100;
    w.fighters[1].x = 150;
    fireUltimate(w);
    expect(w.fighters[1].hp).toBeLessThan(100);
    expect(w.fighters[0].installTicks).toBeGreaterThan(0);
  });

  it('lands a screen-wide ultimate regardless of distance', () => {
    // 'ya' has ultimate-social, one of the kinds that hits unconditionally.
    const w = toFight(world({ p1Character: 'ya' }));
    w.fighters[0].x = ARENA_MAX_X;
    w.fighters[1].x = 120;
    fireUltimate(w, 120);
    expect(w.fighters[1].hp).toBeLessThan(100);
  });

  /**
   * salad's ultimate was a zone; it is now two phases with different guard
   * heights, which is the whole reason it is worth firing. The zone machinery it
   * used to borrow is still there for the ordinary zone specials.
   */
  it('gives the salad ultimate an overhead and then a low, not a zone', () => {
    const w = toFight(world({ p1Character: 'salad' }));
    w.fighters[1].x = 700;
    // Past the startup, so the timeline has begun but none of its beats have.
    fireUltimate(w, getSpec('salad-ult').startupTicks + 1);
    expect(w.zones).toHaveLength(0);
    expect(w.ultimates).toHaveLength(1);

    const heights = ultimateTimelineFor('salad').phases.map((phase) => phase.attackType);
    expect(heights).toEqual(['overhead', 'low']);

    run(w, 120);
    expect(w.fighters[1].hp).toBeLessThan(100);
  });

  it('spends the meter even if the ultimate whiffs', () => {
    const w = toFight(world({ p1Character: 'pink' }));
    w.fighters[0].energy = MAX_ENERGY;
    run(w, 1, BUTTON.Ultimate);
    expect(w.fighters[0].energy).toBe(0);
  });
});

describe('determinism', () => {
  const scripted = (): InputFrame[][] => {
    const script: InputFrame[][] = [];
    for (let i = 0; i < 400; i += 1) {
      script.push([
        i % 17 === 0 ? BUTTON.Light : i % 11 === 0 ? BUTTON.Special : i % 3 === 0 ? BUTTON.Right : EMPTY_INPUT,
        i % 13 === 0 ? BUTTON.Heavy : i % 7 === 0 ? BUTTON.Up : i % 5 === 0 ? BUTTON.Left : EMPTY_INPUT,
      ]);
    }
    return script;
  };

  const play = (script: InputFrame[][]): number => {
    const w = world();
    for (const [p1, p2] of script) stepWorld(w, [p1!, p2!]);
    return checksum(w);
  };

  it('reaches the same checksum from the same inputs', () => {
    const script = scripted();
    expect(play(script)).toBe(play(script));
  });

  it('reaches a different checksum from a single altered input frame', () => {
    /**
     * The frame is altered on the first tick of the fight, where the fighter is
     * idle and free to act. Picking an arbitrary later tick is unreliable: if the
     * fighter happens to be mid-attack or in hit-stop the input is correctly
     * ignored and the checksum legitimately matches.
     */
    const script = scripted();
    const altered = script.map((frame, i) =>
      i === INTRO_TICKS ? [BUTTON.Right, frame[1]!] : frame,
    );
    expect(play(script)).not.toBe(play(altered as InputFrame[][]));
  });

  it('is unaffected by how the inputs are batched', () => {
    // Proves there is no hidden dependency on how many ticks are stepped at once,
    // which is what lets a client run 1 tick or catch up 5 in a frame.
    const script = scripted();
    const a = world();
    for (const [p1, p2] of script) stepWorld(a, [p1!, p2!]);

    const b = world();
    let i = 0;
    while (i < script.length) {
      const batch = Math.min(1 + (i % 5), script.length - i);
      for (let j = 0; j < batch; j += 1) {
        const frame = script[i + j]!;
        stepWorld(b, [frame[0]!, frame[1]!]);
      }
      i += batch;
    }
    expect(checksum(a)).toBe(checksum(b));
  });

  it('never produces NaN in a fighter after a long match', () => {
    const w = world();
    for (const [p1, p2] of scripted()) stepWorld(w, [p1!, p2!]);
    for (const fighter of w.fighters) {
      for (const value of [fighter.x, fighter.y, fighter.vx, fighter.vy, fighter.hp, fighter.energy]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe('checksum', () => {
  it('changes when a fighter position moves by a hundredth of a pixel', () => {
    const a = world();
    const b = world();
    b.fighters[0].x += 0.01;
    expect(checksum(a)).not.toBe(checksum(b));
  });

  it.each([
    ['hp', (w: SimWorld) => { w.fighters[1].hp -= 1; }],
    ['energy', (w: SimWorld) => { w.fighters[0].energy += 1; }],
    ['state', (w: SimWorld) => { w.fighters[0].state = FighterState.CROUCH; }],
    ['facing', (w: SimWorld) => { w.fighters[0].facing = -1; }],
    ['round clock', (w: SimWorld) => { w.roundTicksRemaining -= 1; }],
    ['round wins', (w: SimWorld) => { w.roundWins[0] += 1; }],
    ['hit-stop', (w: SimWorld) => { w.hitStopTicks += 1; }],
    ['phase', (w: SimWorld) => { w.phase = 'fight'; }],
    ['rng', (w: SimWorld) => { w.rng.state += 1; }],
  ])('changes when %s diverges', (_name, mutate) => {
    const a = world();
    const b = world();
    mutate(b);
    expect(checksum(a)).not.toBe(checksum(b));
  });

  it('is stable for two worlds built the same way', () => {
    expect(checksum(world())).toBe(checksum(world()));
  });
});
