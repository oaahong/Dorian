import { describe, it, expect } from 'vitest';
import { FighterState } from '../../fighters/FighterState';
import { ultimateTimelineFor, allUltimateTimelines } from '../../fighters/ultimateTimelines';
import { getSpec } from '../attackSpecs';
import { MAX_ENERGY, MAX_HP } from '../constants';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../input';
import { createWorld, stepWorld, type MatchSetup } from '../world';
import type { SimEvent, SimWorld } from '../types';

/**
 * The ultimates, as timelines rather than as a single box.
 *
 * What these are protecting is that the *beats* are distinguishable: that a low
 * has to be ducked and the overhead ten ticks after it has to be stood up for,
 * that a locked target stays where it was locked, and that a grab which caught
 * nobody spends its whole duration hitting nobody. Collapse any of that and the
 * twelve ultimates become one ultimate with twelve names.
 */

const SETUP: MatchSetup = { seed: 4242, p1Character: 'alien', p2Character: 'ok', stage: 'freezer' };

function fight(overrides: Partial<MatchSetup> = {}): SimWorld {
  const world = createWorld({ ...SETUP, ...overrides });
  while (world.phase !== 'fight') stepWorld(world, [EMPTY_INPUT, EMPTY_INPUT]);
  return world;
}

function run(w: SimWorld, ticks: number, p1: InputFrame = EMPTY_INPUT, p2: InputFrame = EMPTY_INPUT) {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i += 1) events.push(...stepWorld(w, [p1, p2]));
  return events;
}

/**
 * Run until p1's ultimate has finished.
 *
 * A tick count would be wrong: every beat that connects freezes the world, and
 * the freeze pauses the timeline along with everything else, so a 145-tick
 * ultimate occupies rather more than 145 ticks of match.
 */
function runUntilUltimateEnds(w: SimWorld, p2: InputFrame = EMPTY_INPUT): void {
  for (let i = 0; i < 600 && w.ultimates.length > 0; i += 1) run(w, 1, EMPTY_INPUT, p2);
}

/** Fire p1's ultimate and skip the cut-in freeze and the move's own startup. */
function launch(w: SimWorld, fighterId: string): void {
  w.fighters[0].energy = MAX_ENERGY;
  run(w, 1, BUTTON.Down | BUTTON.Special);
  while (w.hitStopTicks > 0) run(w, 1);
  run(w, getSpec(`${fighterId}-ult`).startupTicks);
}

describe('every fighter has a timeline', () => {
  it('covers the whole roster, with no duplicate phase identities', () => {
    for (const timeline of allUltimateTimelines()) {
      // A timeline threatens through phases, through companions, or it does
      // nothing at all — which is the one thing an ultimate must never do.
      const threatens = timeline.phases.length > 0 || timeline.summon !== undefined;
      expect(threatens, timeline.fighterId).toBe(true);

      const seqs = timeline.phases.map((phase) => phase.seq);
      expect(new Set(seqs).size, timeline.fighterId).toBe(seqs.length);
    }
  });

  /** A phase that opened after the timeline ended would never come out at all. */
  it('keeps every phase inside its own timeline', () => {
    for (const timeline of allUltimateTimelines()) {
      for (const phase of timeline.phases) {
        expect(phase.from + phase.ticks, `${timeline.fighterId} ${phase.label}`)
          .toBeLessThanOrEqual(timeline.ticks);
      }
    }
  });

  it('hands control back before the timeline is over', () => {
    for (const timeline of allUltimateTimelines()) {
      expect(timeline.releaseTick, timeline.fighterId).toBeLessThan(timeline.ticks);
    }
  });
});

describe('a locked target does not follow you', () => {
  /**
   * alien locks on at tick 16 and bombards that spot at 70. Walking away in
   * between is supposed to work — it is the entire reason the move has a visible
   * wind-up, and if the box tracked live position the wind-up would be theatre.
   */
  it('bombards where the opponent was, not where they went', () => {
    const w = fight({ p1Character: 'alien', p2Character: 'ok' });
    w.fighters[0].x = 300;
    w.fighters[1].x = 700;
    launch(w, 'alien');

    const timeline = ultimateTimelineFor('alien');
    run(w, timeline.targetLockTick!);
    expect(w.ultimates[0]!.lockedTargetX).toBeCloseTo(700, 0);

    // Walk the opponent away before the bombardment lands.
    run(w, 40, EMPTY_INPUT, BUTTON.Right);
    expect(w.fighters[1].x).toBeGreaterThan(800);
    expect(w.ultimates[0]!.lockedTargetX).toBeCloseTo(700, 0);
  });
});

describe('the beats have different guard heights', () => {
  const heightsOf = (fighterId: string) =>
    ultimateTimelineFor(fighterId).phases.map((phase) => phase.attackType);

  it('gives alien a low sweep before its columns', () => {
    expect(heightsOf('alien')[0]).toBe('low');
  });

  /**
   * salad is the game's one true unblockable-by-one-guard sequence: an overhead
   * at tick 52 and a low at 62, from a single button. Holding one guard through
   * both is supposed to cost you.
   */
  it('makes salad an overhead followed by a low', () => {
    expect(heightsOf('salad')).toEqual(['overhead', 'low']);
  });

  it('lets a standing guard eat the overhead but not the low', () => {
    const standing = fight({ p1Character: 'salad', p2Character: 'ok' });
    standing.fighters[0].x = 500;
    standing.fighters[1].x = 640;
    launch(standing, 'salad');
    // p2 is to the right of p1, so away — and therefore guard — is Right.
    runUntilUltimateEnds(standing, BUTTON.Right);

    const crouching = fight({ p1Character: 'salad', p2Character: 'ok' });
    crouching.fighters[0].x = 500;
    crouching.fighters[1].x = 640;
    launch(crouching, 'salad');
    runUntilUltimateEnds(crouching, BUTTON.Right | BUTTON.Down);

    // Each guard answers exactly one of the two beats, so both take damage — and
    // neither takes all of it. What would be wrong is either one blocking both.
    expect(standing.fighters[1].hp).toBeLessThan(MAX_HP);
    expect(crouching.fighters[1].hp).toBeLessThan(MAX_HP);
    expect(standing.fighters[1].hp).not.toBeCloseTo(crouching.fighters[1].hp, 3);
  });
});

describe('each phase lands at most once', () => {
  it('deals a bounded number of hits however long the box is out', () => {
    const w = fight({ p1Character: 'wizard', p2Character: 'ok' });
    launch(w, 'wizard');
    const events: SimEvent[] = [];
    for (let i = 0; i < 600 && w.ultimates.length > 0; i += 1) {
      events.push(...run(w, 1));
    }

    const phases = events.filter((e) => e.t === 'ultimatePhase');
    const seqs = phases.map((e) => (e as { seq: number }).seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs.length).toBeLessThanOrEqual(ultimateTimelineFor('wizard').phases.length);
  });
});

describe('the transformations', () => {
  it('installs at the timeline tick, not on the move completing', () => {
    const timeline = ultimateTimelineFor('doge');
    const w = fight({ p1Character: 'doge', p2Character: 'ok' });
    launch(w, 'doge');

    // Stepped against the timeline's own clock rather than the world's, because
    // any beat that lands in between freezes one and not the other.
    while (w.ultimates[0]!.elapsedTicks < timeline.install!.atTick - 1) run(w, 1);
    expect(w.fighters[0].installTicks).toBe(0);

    while (w.ultimates[0]!.elapsedTicks < timeline.install!.atTick) run(w, 1);
    expect(w.fighters[0].installTicks).toBe(timeline.install!.ticks);
  });

  /** Goblin's confession costs him health whether or not it moved anybody. */
  it('charges goblin for his own ultimate up front', () => {
    const w = fight({ p1Character: 'goblin', p2Character: 'ok' });
    const before = w.fighters[0].hp;
    launch(w, 'goblin');
    expect(w.fighters[0].hp).toBe(before - ultimateTimelineFor('goblin').selfDamage!);
  });
});

describe('the grab', () => {
  /**
   * ok's ultimate decides on its first tick whether it caught anybody, and lives
   * with the answer. A miss is the price of the rest of it being unblockable.
   */
  it('does nothing at all when it catches nobody', () => {
    const w = fight({ p1Character: 'ok', p2Character: 'wizard' });
    w.fighters[0].x = 200;
    w.fighters[1].x = 1050;
    launch(w, 'ok');
    runUntilUltimateEnds(w);

    expect(w.ultimates).toHaveLength(0);
    expect(w.fighters[1].hp).toBe(MAX_HP);
  });

  it('holds the opponent still once it catches them', () => {
    const w = fight({ p1Character: 'ok', p2Character: 'wizard' });
    w.fighters[0].x = 500;
    w.fighters[1].x = 620;
    launch(w, 'ok');

    const timeline = ultimateTimelineFor('ok');
    run(w, timeline.capture!.from + 2);
    const held = w.fighters[1].x;
    // Mash away from the grab; it must not move them.
    run(w, 20, EMPTY_INPUT, BUTTON.Right | BUTTON.Light);
    expect(w.fighters[1].x).toBeCloseTo(held, 3);
    expect(w.fighters[1].captureTicks).toBeGreaterThan(0);
  });

  it('lets go when the capture window closes', () => {
    const w = fight({ p1Character: 'ok', p2Character: 'wizard' });
    w.fighters[0].x = 500;
    w.fighters[1].x = 620;
    launch(w, 'ok');
    runUntilUltimateEnds(w);
    run(w, 4);
    expect(w.fighters[1].captureTicks).toBe(0);
  });

  it('takes a real bite out of somebody it did catch', () => {
    const w = fight({ p1Character: 'ok', p2Character: 'wizard' });
    w.fighters[0].x = 500;
    w.fighters[1].x = 620;
    launch(w, 'ok');
    runUntilUltimateEnds(w);
    expect(w.fighters[1].hp).toBeLessThan(MAX_HP * 0.75);
  });
});

describe('control and the timeline are separate clocks', () => {
  /**
   * The fighter is freed at `releaseTick` while the ultimate entity lives to the
   * end of its own timeline. Today every authored beat lands before the release,
   * so nothing is *observable* between the two — the split earns its keep for the
   * summon ultimates, whose companions keep swinging for hundreds of ticks after
   * their owner is walking around again. What is assertable now is that the two
   * clocks are genuinely separate rather than one clock read twice.
   */
  it('frees the fighter while the ultimate is still an entity', () => {
    const timeline = ultimateTimelineFor('alien');
    const w = fight({ p1Character: 'alien', p2Character: 'ok' });
    w.fighters[0].x = 500;
    w.fighters[1].x = 620;
    launch(w, 'alien');

    while (w.ultimates[0] && w.ultimates[0].elapsedTicks <= timeline.releaseTick) run(w, 1);
    expect(w.fighters[0].state).not.toBe(FighterState.ULTIMATE);
    expect(w.ultimates).toHaveLength(1);

    runUntilUltimateEnds(w);
    expect(w.ultimates).toHaveLength(0);
  });

  it('deals its damage across the whole timeline, not on one tick', () => {
    const w = fight({ p1Character: 'alien', p2Character: 'ok' });
    w.fighters[0].x = 500;
    w.fighters[1].x = 620;
    launch(w, 'alien');

    const hp: number[] = [];
    for (let i = 0; i < 600 && w.ultimates.length > 0; i += 1) {
      run(w, 1);
      hp.push(w.fighters[1].hp);
    }
    // More than one distinct drop: a single box would produce exactly one.
    const drops = new Set(hp).size;
    expect(drops).toBeGreaterThan(2);
  });
});

describe('an ultimate survives its own startup', () => {
  /**
   * The change that made the timelines matter at all.
   *
   * Before it, a light attack thrown during an ultimate's startup deleted the
   * whole thing — the full meter and every beat that would have followed — for
   * four frames of poke. Caught in a browser and not by any test, because a test
   * opponent stands still and a CPU does not.
   */
  it('cannot be jabbed out of its startup', () => {
    const w = fight({ p1Character: 'alien', p2Character: 'ok' });
    w.fighters[0].x = 560;
    w.fighters[1].x = 640;
    w.fighters[0].energy = MAX_ENERGY;
    run(w, 1, BUTTON.Down | BUTTON.Special);
    while (w.hitStopTicks > 0) run(w, 1);

    // Mash a light into the startup from point-blank range.
    run(w, getSpec('alien-ult').startupTicks, EMPTY_INPUT, BUTTON.Light);
    expect(w.fighters[0].state).toBe(FighterState.ULTIMATE);
    expect(w.fighters[0].hp).toBe(MAX_HP);

    runUntilUltimateEnds(w);
    expect(w.fighters[1].hp).toBeLessThan(MAX_HP);
  });

  /** The recovery is still open, so firing one into a guard is still a mistake. */
  it('is vulnerable again once the startup is over', () => {
    const timeline = ultimateTimelineFor('alien');
    const invulnerable = getSpec('alien-ult').invulnerable;
    expect(invulnerable).toHaveLength(1);
    expect(invulnerable[0]!.to).toBe(getSpec('alien-ult').startupTicks);
    expect(invulnerable[0]!.to).toBeLessThan(timeline.ticks);
  });
});

describe('an ultimate ends with its owner', () => {
  /**
   * The failure this rules out is a stuck victim: a grab whose owner is knocked
   * out mid-hold would otherwise keep re-applying the capture every tick, with
   * nobody left to release it.
   */
  it('stops, and lets go, when the owner is knocked out', () => {
    const w = fight({ p1Character: 'ok', p2Character: 'wizard' });
    w.fighters[0].x = 500;
    w.fighters[1].x = 620;
    launch(w, 'ok');
    run(w, ultimateTimelineFor('ok').capture!.from + 3);
    expect(w.fighters[1].captureTicks).toBeGreaterThan(0);

    w.fighters[0].hp = 0;
    w.fighters[0].state = FighterState.KO;
    run(w, 2);

    expect(w.ultimates).toHaveLength(0);
    expect(w.fighters[1].captureTicks).toBe(0);
  });
});

describe('the summon ultimates', () => {
  /**
   * The two that leave something behind. What makes them different from every
   * other ultimate is that the fighter is free almost immediately while the
   * threat keeps going — ten seconds of it — so these tests are about the
   * companions acting on their own, not about the move that made them.
   */
  it('puts nine clones on the field and frees their owner', () => {
    const plan = ultimateTimelineFor('tempura').summon!;
    const w = fight({ p1Character: 'tempura', p2Character: 'ok' });
    launch(w, 'tempura');

    while (w.ultimates[0]!.elapsedTicks < plan.atTick) run(w, 1);
    expect(w.ultimates[0]!.summons).toHaveLength(plan.offsets!.length);
    expect(w.fighters[0].state).not.toBe(FighterState.ULTIMATE);
  });

  it('keeps the clones near the slots they are supposed to hold', () => {
    const plan = ultimateTimelineFor('tempura').summon!;
    const w = fight({ p1Character: 'tempura', p2Character: 'ok' });
    w.fighters[0].x = 500;
    launch(w, 'tempura');
    while (w.ultimates[0]!.elapsedTicks < plan.atTick + 40) run(w, 1);

    for (const summon of w.ultimates[0]!.summons) {
      const slot = w.fighters[0].x + plan.offsets![summon.slot]!;
      // Eased rather than snapped, so "near" is the assertion, not "at".
      expect(Math.abs(summon.x - slot), `slot ${summon.slot}`).toBeLessThan(60);
    }
  });

  it('hurts an opponent who stands in the formation', () => {
    const w = fight({ p1Character: 'tempura', p2Character: 'ok' });
    w.fighters[0].x = 500;
    w.fighters[1].x = 590; // inside the +90 slot
    launch(w, 'tempura');
    run(w, 120);
    expect(w.fighters[1].hp).toBeLessThan(MAX_HP);
  });

  it('lets the opponent knock a clone down', () => {
    const plan = ultimateTimelineFor('tempura').summon!;
    const w = fight({ p1Character: 'tempura', p2Character: 'ok' });
    w.fighters[0].x = 500;
    w.fighters[1].x = 600;
    launch(w, 'tempura');
    while (w.ultimates[0]!.elapsedTicks < plan.atTick + 2) run(w, 1);
    const before = w.ultimates[0]!.summons.length;

    // Swing repeatedly at whatever is standing there.
    for (let i = 0; i < 60; i += 1) run(w, 1, EMPTY_INPUT, i % 20 < 2 ? BUTTON.Light : EMPTY_INPUT);
    expect(w.ultimates[0]!.summons.length).toBeLessThan(before);
  });

  it('walks the husky toward the opponent and bites', () => {
    const plan = ultimateTimelineFor('scared').summon!;
    const w = fight({ p1Character: 'scared', p2Character: 'ok' });
    w.fighters[0].x = 300;
    w.fighters[1].x = 1000;
    launch(w, 'scared');
    while (w.ultimates[0]!.elapsedTicks < plan.atTick) run(w, 1);

    const start = w.ultimates[0]!.summons[0]!.x;
    run(w, 200);
    const husky = w.ultimates[0]?.summons[0];
    expect(husky).toBeDefined();
    expect(husky!.x).toBeGreaterThan(start);
    expect(w.fighters[1].hp).toBeLessThan(MAX_HP);
  });

  /** Four hit points, so clearing it is a real option and a real cost. */
  it('lets the husky be put down', () => {
    const plan = ultimateTimelineFor('scared').summon!;
    const w = fight({ p1Character: 'scared', p2Character: 'ok' });
    w.fighters[0].x = 500;
    w.fighters[1].x = 620;
    launch(w, 'scared');
    while (w.ultimates[0]!.elapsedTicks < plan.atTick + 1) run(w, 1);

    // Park the husky next to the opponent and swing until it is gone.
    w.ultimates[0]!.summons[0]!.x = w.fighters[1].x - 40;
    for (let i = 0; i < 200 && (w.ultimates[0]?.summons.length ?? 0) > 0; i += 1) {
      run(w, 1, EMPTY_INPUT, i % 20 < 2 ? BUTTON.Light : EMPTY_INPUT);
    }
    expect(w.ultimates[0]?.summons ?? []).toHaveLength(0);
  });

  /**
   * A companion hitting once every `rehitTicks` is the difference between
   * pressure and instant death — nine clones with no cooldown would delete a
   * hundred hit points in under a second.
   */
  it('gives each companion a cooldown between its hits', () => {
    const plan = ultimateTimelineFor('tempura').summon!;
    const w = fight({ p1Character: 'tempura', p2Character: 'ok' });
    w.fighters[0].x = 500;
    w.fighters[1].x = 590;
    launch(w, 'tempura');
    run(w, 60);

    const lost = MAX_HP - w.fighters[1].hp;
    // Far below what an uncapped formation would have taken off by now.
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(MAX_HP / 2);
  });

  it('clears the companions when the round restarts', () => {
    const w = fight({ p1Character: 'tempura', p2Character: 'ok' });
    launch(w, 'tempura');
    run(w, 40);
    expect(w.ultimates[0]!.summons.length).toBeGreaterThan(0);

    w.fighters[1].hp = 0;
    w.fighters[1].state = FighterState.KO;
    for (let i = 0; i < 400 && w.phase !== 'fight'; i += 1) run(w, 1);
    for (let i = 0; i < 400 && w.roundNumber === 1; i += 1) run(w, 1);
    expect(w.ultimates).toHaveLength(0);
  });
});

describe('a formation is wider than a corner', () => {
  /**
   * Clone slots are not clamped to the arena, and that is the whole point.
   *
   * Clamping is what the upgraded build does, and against a wall it folds four
   * slots onto one point — nine clones become nine hitboxes in the same place,
   * every one connecting on the same tick. Measured before the fix: a full-health
   * opponent standing in a cornered formation died in under three seconds.
   */
  it('does not stack clones on top of each other in the corner', () => {
    const plan = ultimateTimelineFor('tempura').summon!;
    const w = fight({ p1Character: 'tempura', p2Character: 'ok' });
    w.fighters[0].x = 95; // hard against the left wall
    launch(w, 'tempura');
    while (w.ultimates[0]!.elapsedTicks < plan.atTick) run(w, 1);

    const positions = w.ultimates[0]!.summons.map((summon) => Math.round(summon.x));
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('keeps a cornered formation survivable for longer than a moment', () => {
    const w = fight({ p1Character: 'tempura', p2Character: 'ok' });
    w.fighters[0].x = 95;
    w.fighters[1].x = 185; // parked inside the formation
    launch(w, 'tempura');
    run(w, 180); // three seconds of standing in it

    // Bruising, not lethal. The answer is to leave, and leaving must be possible.
    expect(w.fighters[1].hp).toBeLessThan(MAX_HP);
    expect(w.fighters[1].hp).toBeGreaterThan(0);
  });
});
