import { describe, it, expect } from 'vitest';
import { CpuBrain } from '../cpu';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../input';
import { MAX_ENERGY } from '../constants';
import { createRng } from '../rng';
import { checksum, createWorld, stepWorld, type MatchSetup } from '../world';
import type { SimWorld } from '../types';

/**
 * Golden replays: the regression net for the whole simulation.
 *
 * Each scenario drives a scripted match and snapshots a trail of world
 * checksums. Any change to physics, frame data, hit resolution or round flow
 * moves those numbers, so an accidental behaviour change fails here loudly
 * instead of being discovered by a player.
 *
 * When a snapshot fails, decide which it is before running `-u`:
 *   - an unintended regression, or
 *   - a deliberate balance or timing change, in which case regenerate and say so
 *     in the commit message.
 *
 * Inputs are generated from a pure function of the tick rather than stored as
 * data, so the scenario stays readable and the fixture stays small.
 */

const SETUP: MatchSetup = {
  seed: 20260815,
  p1Character: 'pink',
  p2Character: 'wizard',
  stage: 'freezer',
};

/** Sample the world every `every` ticks, so the trail localises a divergence. */
function trail(world: SimWorld, ticks: number, script: (tick: number) => [InputFrame, InputFrame], every = 120) {
  const checksums: string[] = [];
  for (let i = 0; i < ticks; i += 1) {
    stepWorld(world, script(i));
    if ((i + 1) % every === 0) checksums.push(`t${i + 1}:${checksum(world).toString(16)}`);
  }
  return checksums;
}

function summarise(world: SimWorld) {
  return {
    tick: world.tick,
    phase: world.phase,
    round: world.roundNumber,
    roundWins: [...world.roundWins],
    matchWinner: world.matchWinner,
    p1: { hp: +world.fighters[0].hp.toFixed(4), x: +world.fighters[0].x.toFixed(4), state: world.fighters[0].state },
    p2: { hp: +world.fighters[1].hp.toFixed(4), x: +world.fighters[1].x.toFixed(4), state: world.fighters[1].state },
  };
}

describe('two-player scripted match', () => {
  // A rotation that exercises walking, jumping, both normals, the special and the
  // ultimate motion for both seats. The special is pressed for a single tick with
  // no motion behind it, which now winds up the chargeable special and releases it
  // at level 1 — the shortest, most common thing a real player does with it.
  //
  // The directions are *held* across a span of ticks rather than tapped on a
  // modulus. Once dashes existed, a one-tick tap every third tick was a double tap
  // by definition, so both fighters dashed for the entire match and never threw a
  // punch — which is a fine thing for the simulation to do and a useless thing for
  // a regression net to record.
  const script = (tick: number): [InputFrame, InputFrame] => {
    const p1 =
      tick % 53 === 0 ? BUTTON.Down | BUTTON.Special
      : tick % 31 === 0 ? BUTTON.Special
      : tick % 19 === 0 ? BUTTON.Heavy
      : tick % 7 === 0 ? BUTTON.Light
      : tick % 12 < 6 ? BUTTON.Right
      : EMPTY_INPUT;
    const p2 =
      tick % 61 === 0 ? BUTTON.Down | BUTTON.Special
      : tick % 37 === 0 ? BUTTON.Special
      : tick % 23 === 0 ? BUTTON.Up
      : tick % 11 === 0 ? BUTTON.Heavy
      : tick % 16 < 7 ? BUTTON.Left
      : EMPTY_INPUT;
    return [p1, p2];
  };

  it('matches the recorded checksum trail', () => {
    const world = createWorld(SETUP);
    expect(trail(world, 1200, script)).toMatchSnapshot();
  });

  it('matches the recorded final state', () => {
    const world = createWorld(SETUP);
    trail(world, 1200, script);
    expect(summarise(world)).toMatchSnapshot();
  });
});

describe('projectile and zone characters', () => {
  // 'ya' throws a projectile; 'alien' fires a beam and places a zone.
  const setup: MatchSetup = { ...SETUP, p1Character: 'ya', p2Character: 'alien' };
  const script = (tick: number): [InputFrame, InputFrame] => [
    tick % 41 === 0 ? BUTTON.Special : tick % 4 === 0 ? BUTTON.Right : EMPTY_INPUT,
    tick % 47 === 0 ? BUTTON.Special : tick % 6 === 0 ? BUTTON.Left : EMPTY_INPUT,
  ];

  it('matches the recorded checksum trail', () => {
    const world = createWorld(setup);
    expect(trail(world, 900, script)).toMatchSnapshot();
  });
});

/**
 * The ultimates, which none of the other scenarios ever reach.
 *
 * Their timelines are the most intricate thing in the simulation — up to a dozen
 * boxes at different heights, a locked target, an install part-way through, a
 * grab that decides on its first tick whether it caught anybody — and until this
 * existed, none of it had a regression net at all. The meter is granted directly
 * rather than earned, because the point is the timeline, not the road to it.
 */
describe('ultimate timelines', () => {
  const fireAt = (tick: number): [InputFrame, InputFrame] => [
    tick % 200 === 0 ? BUTTON.Down | BUTTON.Special : tick % 9 === 0 ? BUTTON.Right : EMPTY_INPUT,
    tick % 6 === 0 ? BUTTON.Left : EMPTY_INPUT,
  ];

  const pairs: [string, string][] = [
    ['alien', 'salad'],   // a locked target, and an overhead-then-low mix-up
    ['ok', 'wizard'],     // a grab, and four fixed tentacles
    ['doge', 'sauce'],    // a transformation, and a blinking rampage
  ];

  for (const [p1, p2] of pairs) {
    it(`replays ${p1} against ${p2} identically`, () => {
      const play = () => {
        const world = createWorld({ ...SETUP, p1Character: p1, p2Character: p2 });
        const checksums: string[] = [];
        for (let i = 0; i < 900; i += 1) {
          // Topped up every tick, so the ultimate is always available on cue and
          // the scenario does not depend on how the meter happened to build.
          world.fighters[0].energy = MAX_ENERGY;
          stepWorld(world, fireAt(i));
          if ((i + 1) % 150 === 0) checksums.push(`t${i + 1}:${checksum(world).toString(16)}`);
        }
        return { checksums, summary: summarise(world) };
      };
      const first = play();
      expect(play()).toEqual(first);
      expect(first.checksums).toMatchSnapshot();
      expect(first.summary).toMatchSnapshot();
    });
  }
});

describe('match played to a decision', () => {
  // Both sides mash, so the match reaches a winner rather than timing out.
  const script = (tick: number): [InputFrame, InputFrame] => [
    tick % 13 === 0 ? BUTTON.Heavy : tick % 5 === 0 ? BUTTON.Light : BUTTON.Right,
    tick % 17 === 0 ? BUTTON.Heavy : tick % 6 === 0 ? BUTTON.Light : BUTTON.Left,
  ];

  it('reaches a winner and matches the recorded outcome', () => {
    const world = createWorld(SETUP);
    for (let i = 0; i < 6000 && world.matchWinner === null; i += 1) stepWorld(world, script(i));
    expect(world.matchWinner).not.toBeNull();
    expect(summarise(world)).toMatchSnapshot();
  });
});

describe('one-player match against the CPU', () => {
  it('replays identically, including every CPU decision', () => {
    /**
     * The CPU brain is seeded, so a 1P match is as reproducible as a 2P one.
     * That is what makes this scenario worth recording at all — with
     * `Math.random` it could never have been a fixture.
     */
    const play = () => {
      const world = createWorld(SETUP);
      const brain = new CpuBrain(1, 'normal', createRng(SETUP.seed ^ 0x5f5f));
      const checksums: string[] = [];
      for (let i = 0; i < 900; i += 1) {
        const p1 = i % 11 === 0 ? BUTTON.Heavy : i % 4 === 0 ? BUTTON.Right : EMPTY_INPUT;
        stepWorld(world, [p1, brain.decide(world)]);
        if ((i + 1) % 150 === 0) checksums.push(`t${i + 1}:${checksum(world).toString(16)}`);
      }
      return { checksums, summary: summarise(world) };
    };

    const first = play();
    expect(play()).toEqual(first);
    expect(first.checksums).toMatchSnapshot();
    expect(first.summary).toMatchSnapshot();
  });
});
