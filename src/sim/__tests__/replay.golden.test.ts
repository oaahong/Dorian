import { describe, it, expect } from 'vitest';
import { CpuBrain } from '../cpu';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../input';
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
  const script = (tick: number): [InputFrame, InputFrame] => {
    const p1 =
      tick % 53 === 0 ? BUTTON.Down | BUTTON.Special
      : tick % 31 === 0 ? BUTTON.Special
      : tick % 19 === 0 ? BUTTON.Heavy
      : tick % 7 === 0 ? BUTTON.Light
      : tick % 3 === 0 ? BUTTON.Right
      : EMPTY_INPUT;
    const p2 =
      tick % 61 === 0 ? BUTTON.Down | BUTTON.Special
      : tick % 37 === 0 ? BUTTON.Special
      : tick % 23 === 0 ? BUTTON.Up
      : tick % 11 === 0 ? BUTTON.Heavy
      : tick % 5 === 0 ? BUTTON.Left
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
