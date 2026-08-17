import type { AttackType } from '../combat/AttackSpec';
import { ARENA_MAX_X, ARENA_MIN_X, GROUND_Y } from '../sim/constants';

/**
 * What each ultimate actually *does*, as a list of hitboxes over time.
 *
 * An ultimate here used to be one box on one tick, which made twelve very
 * different finishers play identically: press the button, the screen flashes,
 * somebody takes a number. The upgraded build scripts them — alien sweeps the
 * floor, then a vertical column, then bombards where you were standing, then
 * covers the screen; salad drops something you have to *stand*-block and then
 * cracks the ground you would have ducked to — and that is the difference
 * between a super and a cutscene with damage attached.
 *
 * **This file is data, and deliberately so.** In the upgraded build the boxes and
 * the Phaser images that draw them live in the same function: one `if (p === 36)`
 * both spawns a sprite and, ten lines away, contributes a rectangle. That cannot
 * cross into `sim` — half of it imports Phaser — and splitting it by hand every
 * time would be a standing invitation for the two halves to drift. So the
 * geometry and the timing live here, the simulation reads them, and the render
 * layer is told what happened through events. Nothing in this file draws.
 *
 * Every duration is in ticks, measured from the ultimate's first *unfrozen* tick:
 * the cut-in has already finished by then, because it is spent as hit-stop before
 * the timeline is created.
 */

/**
 * Where a phase's box is measured from.
 *
 * The distinction that matters is `lockedTarget` versus `opponent`. A locked
 * target is where they *were* when the move committed — that is what makes
 * alien's bombardment and salad's bowl dodgeable, and it is the entire reason
 * those two have a wind-up worth watching. An `opponent` anchor tracks them live,
 * which is only correct for a move that has already caught them.
 */
export type UltimateAnchor = 'arena' | 'absolute' | 'lockedTarget' | 'opponent' | 'owner';

export interface UltimatePhase {
  /**
   * Which threat this is, for hit tracking. Each phase connects at most once, so
   * a four-part ultimate lands four times and not forty.
   */
  seq: number;
  /** First tick the box is out, 1-based like the rest of the frame data. */
  from: number;
  /** How many ticks it stays out. */
  ticks: number;
  damage: number;
  /** Which guard answers it — the reason a multi-phase ultimate is a read. */
  attackType: AttackType;
  /** Shown by the HUD while the phase is live. */
  label: string;
  anchor: UltimateAnchor;
  /** Left edge relative to the anchor. Ignored when the anchor is `arena`. */
  offsetX: number;
  y: number;
  width: number;
  height: number;
}

export interface UltimateTimeline {
  fighterId: string;
  /** Total ticks before the ultimate is over and the fighter is free. */
  ticks: number;
  /**
   * When the opponent's position is captured for `lockedTarget` phases, or null
   * when no phase needs it.
   */
  targetLockTick: number | null;
  /** The tick control returns, so the rest of the timeline plays out unowned. */
  releaseTick: number;
  phases: UltimatePhase[];
  /** An install granted partway through, rather than on completion. */
  install?: { atTick: number; ticks: number };
  /** HP the owner pays up front. Goblin's confession costs him something. */
  selfDamage?: number;
  /**
   * The opponent is held in place between these ticks.
   *
   * Only `ok` has one, and without it the nine small hits that follow would land
   * on someone who simply walked away — which is not a grab, it is a whiff with
   * extra steps.
   */
  capture?: { from: number; to: number; range: number };
  /** The owner teleports every `everyTicks`, up to `spreadX` in either direction. */
  blink?: { fromTick: number; toTick: number; everyTicks: number; spreadX: number };
}

const ARENA_WIDTH = ARENA_MAX_X - ARENA_MIN_X;

/** The screen-filling threat every ultimate ends on. Upgraded's `full()`. */
const fullscreen = (
  seq: number,
  from: number,
  ticks: number,
  damage: number,
  label: string,
  attackType: AttackType = 'mid',
): UltimatePhase => ({
  seq, from, ticks, damage, attackType, label,
  anchor: 'arena', offsetX: 0, y: 120, width: ARENA_WIDTH, height: 500,
});

/** The four transformations, which differ only in when they land and how hard. */
const installUltimate = (
  fighterId: string,
  burst: { at: number; damage: number; label: string },
  installAt: number,
): UltimateTimeline => ({
  fighterId,
  ticks: 115,
  targetLockTick: null,
  releaseTick: 64,
  phases: [fullscreen(0, burst.at, 5, burst.damage, burst.label)],
  install: { atTick: installAt, ticks: 480 },
});

/**
 * Sauce's rampage is a burst repeated on a modulus rather than a handful of named
 * beats, so it is expanded into explicit phases here instead of being computed in
 * the simulation. Same result, and the hot path never has to know that some
 * ultimates are periodic and others are not.
 */
function sauceDashes(): UltimatePhase[] {
  const phases: UltimatePhase[] = [];
  for (let tick = 11; tick < 65; tick += 7) {
    phases.push({
      seq: phases.length,
      from: tick,
      ticks: 3,
      damage: 3,
      attackType: 'mid',
      label: 'SAUCE DASH',
      anchor: 'owner',
      offsetX: -80,
      y: 260,
      width: 160,
      height: 350,
    });
  }
  return phases;
}

/** The same expansion for ok's flurry: nine small hits, then the launch. */
function okFlurry(): UltimatePhase[] {
  const phases: UltimatePhase[] = [];
  for (let tick = 48; tick <= 90; tick += 5) {
    phases.push({
      seq: phases.length,
      from: tick,
      ticks: 2,
      damage: 2.3,
      attackType: 'mid',
      label: 'SMALL HIT',
      anchor: 'opponent',
      offsetX: -70,
      y: 260,
      width: 140,
      height: 330,
    });
  }
  return phases;
}

const TIMELINES: UltimateTimeline[] = [
  /**
   * Four beats, three of them dodgeable, and the order teaches you the move: a
   * low sweep you must duck, a column where you were standing, a wider bombard on
   * the same spot, and only then the screen.
   */
  {
    fighterId: 'alien',
    ticks: 115,
    targetLockTick: 16,
    releaseTick: 102,
    phases: [
      {
        seq: 0, from: 26, ticks: 5, damage: 6, attackType: 'low', label: 'HORIZONTAL SCAN',
        anchor: 'arena', offsetX: 0, y: 500, width: ARENA_WIDTH, height: 95,
      },
      {
        seq: 1, from: 36, ticks: 5, damage: 6, attackType: 'mid', label: 'VERTICAL SCAN',
        anchor: 'lockedTarget', offsetX: -75, y: 120, width: 150, height: 500,
      },
      {
        seq: 2, from: 70, ticks: 8, damage: 10, attackType: 'mid', label: 'LOCK BOMBARD',
        anchor: 'lockedTarget', offsetX: -140, y: 120, width: 280, height: 500,
      },
      fullscreen(3, 92, 5, 14, 'FULL FREQUENCY'),
    ],
  },

  installUltimate('doge', { at: 54, damage: 10, label: 'POWER BURST' }, 54),

  {
    fighterId: 'ya',
    ticks: 115,
    targetLockTick: null,
    releaseTick: 70,
    phases: [fullscreen(0, 64, 5, 28, 'PHOTO TEAR')],
  },

  /**
   * Penguin's clones and husky's companion are summons that outlive the move, and
   * their boxes follow entities that do not exist yet in this simulation. Until
   * they do, both keep the single screen-wide finish they were ported with, so
   * the ultimate still resolves rather than doing nothing at all.
   */
  {
    fighterId: 'tempura',
    ticks: 115,
    targetLockTick: null,
    releaseTick: 30,
    phases: [fullscreen(0, 34, 6, 16, 'PENGUIN COLUMN')],
  },

  {
    fighterId: 'goblin',
    ticks: 115,
    targetLockTick: null,
    releaseTick: 60,
    phases: [fullscreen(0, 45, 5, 8, 'ROMANCE FLASH')],
    install: { atTick: 54, ticks: 480 },
    selfDamage: 8,
  },

  /**
   * The one true high/low mix-up in the game: an overhead you have to stand-block
   * followed ten ticks later by a low you have to crouch-block, from one button.
   */
  {
    fighterId: 'salad',
    ticks: 115,
    targetLockTick: 8,
    releaseTick: 80,
    phases: [
      {
        seq: 0, from: 52, ticks: 10, damage: 18, attackType: 'overhead', label: 'DIRECT BOWL',
        anchor: 'lockedTarget', offsetX: -75, y: 80, width: 150, height: 530,
      },
      {
        seq: 1, from: 62, ticks: 7, damage: 13, attackType: 'low', label: 'GROUND IMPACT',
        anchor: 'lockedTarget', offsetX: -210, y: 490, width: 420, height: 120,
      },
    ],
  },

  /** Four tentacles at fixed positions, so where you stand decides how many hit. */
  {
    fighterId: 'wizard',
    ticks: 130,
    targetLockTick: null,
    releaseTick: 100,
    phases: [
      ...[0, 1, 2, 3].map((i): UltimatePhase => ({
        seq: i,
        from: 28 + i * 10,
        ticks: 5,
        damage: 5,
        attackType: 'mid',
        label: 'TENTACLE',
        anchor: 'absolute',
        offsetX: 180 + i * 250,
        y: 280,
        width: 180,
        height: 330,
      })),
      fullscreen(5, 94, 5, 12, 'CTHULHU PULSE'),
    ],
  },

  installUltimate('blade', { at: 58, damage: 15, label: 'X SLASH' }, 54),
  installUltimate('pink', { at: 58, damage: 13, label: 'REAL FACE BURST' }, 48),

  {
    fighterId: 'sauce',
    ticks: 140,
    targetLockTick: null,
    releaseTick: 100,
    phases: [
      ...sauceDashes(),
      fullscreen(99, 88, 5, 13, 'SAUCE EXPLOSION'),
    ],
    blink: { fromTick: 11, toTick: 64, everyTicks: 7, spreadX: 210 },
  },

  {
    fighterId: 'scared',
    ticks: 115,
    targetLockTick: null,
    releaseTick: 30,
    phases: [fullscreen(0, 30, 6, 14, 'HUSKY CHARGE')],
  },

  /**
   * A grab, so it opens by *checking* whether it caught anybody. Miss and the
   * whole hundred and forty ticks play out with no boxes at all — which is the
   * price of the highest-damage ultimate in the game being unblockable once it
   * lands.
   */
  {
    fighterId: 'ok',
    ticks: 145,
    targetLockTick: null,
    releaseTick: 120,
    phases: [
      ...okFlurry(),
      {
        seq: 99, from: 104, ticks: 5, damage: 10, attackType: 'mid', label: 'FINAL LAUNCH',
        anchor: 'opponent', offsetX: -100, y: 240, width: 200, height: 370,
      },
    ],
    capture: { from: 20, to: 104, range: 300 },
  },
];

const BY_FIGHTER = new Map(TIMELINES.map((timeline) => [timeline.fighterId, timeline]));

/**
 * The timeline for a fighter's ultimate.
 *
 * Throws rather than returning undefined, for the same reason `getSpec` does: an
 * ultimate that silently resolved to no timeline would be a super that costs the
 * whole bar and does nothing, discovered by a player rather than by a test.
 */
export function ultimateTimelineFor(fighterId: string): UltimateTimeline {
  const timeline = BY_FIGHTER.get(fighterId);
  if (!timeline) throw new Error(`No ultimate timeline for fighter: ${fighterId}`);
  return timeline;
}

export function allUltimateTimelines(): UltimateTimeline[] {
  return TIMELINES;
}

/** Ground level, re-exported so phase geometry can be read against something. */
export { GROUND_Y };
