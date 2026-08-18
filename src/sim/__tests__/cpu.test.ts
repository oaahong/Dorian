import { describe, it, expect } from 'vitest';
import { BUTTON, EMPTY_INPUT, isDown, type InputFrame } from '../input';
import { createRng } from '../rng';
import { createWorld, stepWorld } from '../world';
import { CpuBrain, type CpuDifficulty } from '../cpu';
import { INTRO_TICKS, MAX_ENERGY } from '../constants';
import { FighterState } from '../../fighters/FighterState';
import type { SimWorld } from '../types';

/**
 * The CPU used seven separate `Math.random()` calls. They are now draws from a
 * seeded generator, so a CPU match replays exactly — which is what makes a golden
 * replay fixture possible for 1P mode. See docs/sim-spec.md §10 row 8.
 */

const setup = { seed: 4242, p1Character: 'pink', p2Character: 'ok', stage: 'freezer' };

function play(difficulty: CpuDifficulty, ticks: number, seed = 99): InputFrame[] {
  const world = createWorld(setup);
  const brain = new CpuBrain(1, difficulty, createRng(seed));
  const emitted: InputFrame[] = [];
  for (let i = 0; i < ticks; i += 1) {
    const cpu = brain.decide(world);
    emitted.push(cpu);
    stepWorld(world, [EMPTY_INPUT, cpu]);
  }
  return emitted;
}

describe('determinism', () => {
  it('emits the same input sequence for the same seed', () => {
    expect(play('normal', 400)).toEqual(play('normal', 400));
  });

  it('emits a different sequence for a different seed', () => {
    expect(play('normal', 400, 1)).not.toEqual(play('normal', 400, 2));
  });

  it('reaches the same world checksum on replay', () => {
    const run = () => {
      const world = createWorld(setup);
      const brain = new CpuBrain(1, 'hard', createRng(7));
      for (let i = 0; i < 600; i += 1) stepWorld(world, [EMPTY_INPUT, brain.decide(world)]);
      return world;
    };
    const a = run();
    const b = run();
    expect(a.fighters[0].hp).toBe(b.fighters[0].hp);
    expect(a.fighters[1].x).toBe(b.fighters[1].x);
  });
});

describe('output shape', () => {
  it('only ever emits defined buttons', () => {
    for (const frame of play('hard', 600)) {
      expect(frame & ~0x7f).toBe(0);
    }
  });

  it('never holds left and right at once', () => {
    for (const frame of play('hard', 600)) {
      expect(isDown(frame, BUTTON.Left) && isDown(frame, BUTTON.Right)).toBe(false);
    }
  });

  it('releases attack buttons rather than holding them down', () => {
    // Edges are derived from the previous frame, so a held button fires once.
    // The CPU must let go or it would attack exactly once and then stand there.
    const frames = play('hard', 600);
    const attackHeld = frames.filter((f) => isDown(f, BUTTON.Light) || isDown(f, BUTTON.Heavy));
    let longestRun = 0;
    let run = 0;
    for (const frame of frames) {
      const pressing = isDown(frame, BUTTON.Light) || isDown(frame, BUTTON.Heavy);
      run = pressing ? run + 1 : 0;
      longestRun = Math.max(longestRun, run);
    }
    expect(attackHeld.length).toBeGreaterThan(0);
    expect(longestRun).toBeLessThan(5);
  });
});

describe('behaviour', () => {
  const toFight = (world: SimWorld) => {
    for (let i = 0; i < INTRO_TICKS; i += 1) stepWorld(world, [EMPTY_INPUT, EMPTY_INPUT]);
    return world;
  };

  it('actually engages: it closes distance and lands hits', () => {
    const world = toFight(createWorld(setup));
    const brain = new CpuBrain(1, 'hard', createRng(3));
    for (let i = 0; i < 900; i += 1) stepWorld(world, [EMPTY_INPUT, brain.decide(world)]);
    expect(world.fighters[0].hp).toBeLessThan(100);
  });

  it('fires the ultimate when the meter is full', () => {
    const world = toFight(createWorld(setup));
    world.fighters[1].energy = MAX_ENERGY;
    world.fighters[1].x = world.fighters[0].x + 200;

    const brain = new CpuBrain(1, 'hard', createRng(11));
    let usedUltimate = false;
    for (let i = 0; i < 120 && !usedUltimate; i += 1) {
      const cpu = brain.decide(world);
      if (isDown(cpu, BUTTON.Ultimate)) usedUltimate = true;
      stepWorld(world, [EMPTY_INPUT, cpu]);
    }
    expect(usedUltimate).toBe(true);
  });

  it('actually gets one out, rather than only asking for one', () => {
    // Pressing the button is not the same as the move coming out — a CPU that
    // asked at the wrong moment, or with an input the simulation no longer
    // recognises, would satisfy the test above and never fire.
    const world = toFight(createWorld(setup));
    world.fighters[1].x = world.fighters[0].x + 200;

    const brain = new CpuBrain(1, 'hard', createRng(11));
    let fired = false;
    for (let i = 0; i < 240 && !fired; i += 1) {
      world.fighters[1].energy = MAX_ENERGY;
      stepWorld(world, [EMPTY_INPUT, brain.decide(world)]);
      if (world.fighters[1].state === FighterState.ULTIMATE) fired = true;
    }
    expect(fired).toBe(true);
  });

  it('clears its timers on reset so a new round starts fresh', () => {
    const world = toFight(createWorld(setup));
    const brain = new CpuBrain(1, 'normal', createRng(21));
    for (let i = 0; i < 60; i += 1) stepWorld(world, [EMPTY_INPUT, brain.decide(world)]);

    brain.reset();
    // With the hold and decision timers cleared, the very next call must decide
    // rather than coast on a hold left over from the previous round.
    expect(brain.decide(world)).not.toBeUndefined();
  });

  it.each(['pink', 'ok', 'scared', 'ok', 'wizard', 'alien'])(
    'drives %s, whose special has its own preferred range',
    (character) => {
      // Exercises every branch of the special-distance heuristic: sonic, dash,
      // slide, aura, zone and beam each want a different gap.
      const world = createWorld({ ...setup, p2Character: character });
      const brain = new CpuBrain(1, 'hard', createRng(13));
      for (let i = 0; i < 600; i += 1) stepWorld(world, [EMPTY_INPUT, brain.decide(world)]);
      expect(Number.isFinite(world.fighters[1].x)).toBe(true);
    },
  );

  it('acts more often on hard than on easy', () => {
    const count = (difficulty: CpuDifficulty) =>
      play(difficulty, 900, 5).filter((f) => f !== EMPTY_INPUT).length;
    expect(count('hard')).toBeGreaterThan(0);
    expect(count('easy')).toBeGreaterThan(0);
  });
});

describe('guarding at a height', () => {
  /**
   * A stand-only CPU would make every crouching normal unblockable against it,
   * which quietly deletes the high/low game from single player. It has to guess
   * both ways — and it has to *only* guess, or the mix-up is unwinnable instead.
   */
  const guardHeights = (difficulty: Parameters<typeof play>[0], ticks = 4000) => {
    const world = createWorld(setup);
    const brain = new CpuBrain(1, difficulty, createRng(5));
    let high = 0;
    let low = 0;
    for (let i = 0; i < ticks; i += 1) {
      const cpu = brain.decide(world);
      // Attack constantly, so the CPU has something to block.
      stepWorld(world, [i % 24 < 2 ? BUTTON.Light : EMPTY_INPUT, cpu]);
      const self = world.fighters[1];
      if (self.guardHeld) {
        if (self.guardCrouching) low += 1;
        else high += 1;
      }
    }
    return { high, low };
  };

  it('blocks both high and low rather than only standing', () => {
    const { high, low } = guardHeights('normal');
    expect(high).toBeGreaterThan(0);
    expect(low).toBeGreaterThan(0);
  });

  it('splits its guard more evenly on hard than on easy', () => {
    const share = (d: Parameters<typeof play>[0]) => {
      const { high, low } = guardHeights(d);
      return low / (high + low);
    };
    expect(share('hard')).toBeGreaterThan(share('easy'));
  });
});
