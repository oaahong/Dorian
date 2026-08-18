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
  /** Companions put into the world, which then act on their own. */
  summon?: SummonPlan;
}

/**
 * What an ultimate leaves standing on the field.
 *
 * Two shapes, because the upgraded build has exactly two and they are opposites:
 * a `clone` holds a fixed offset from its owner and swings at whatever is beside
 * it, while a `husky` ignores its owner entirely and walks the opponent down. A
 * single "summon AI" covering both would be a parameter bag with one caller each.
 */
export interface SummonPlan {
  kind: 'clone' | 'husky';
  /** When they arrive. Control is handed back on the same tick. */
  atTick: number;
  /** Hit points each, so the opponent can clear them out early. */
  hp: number;
  damage: number;
  /** Ticks between one companion's hits. Its rhythm, not the timeline's. */
  rehitTicks: number;
  /**
   * Stun and knockback for a companion's hit, which are its own and not the
   * ultimate's.
   *
   * Inheriting them was wrong in both directions: the husky's bite borrowed 46
   * ticks of hitstun against its own 54-tick cooldown, leaving the victim eight
   * frames an attempt to answer a dog, and 520 of knockback threw them half the
   * arena away from a nibble. A companion is pressure — it should sting and let
   * you move, not launch you and lock you.
   */
  hitstun: number;
  knockbackX: number;
  /** The box each one swings, relative to its own position. */
  box: { offsetX: number; y: number; width: number; height: number };
  /** Where each stands, as offsets from the owner. Clones only. */
  offsets?: number[];
  /** How fast it walks toward the opponent, and how close it wants to be. Husky. */
  chase?: { speed: number; standoff: number; reach: number };
  /** How far behind the owner it starts. Husky. */
  spawnOffsetX?: number;
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
  /**
   * Nine of him, in a line, for ten seconds.
   *
   * The clones hold their offsets and swing at whatever is standing next to them,
   * so the threat is positional rather than timed: walking into the formation is
   * what hurts, and the answer is to leave — or to knock the nearest one down,
   * since each has a single hit point. Control returns the moment they arrive,
   * which is the whole idea. The owner is free while nine of him are not.
   */
  {
    fighterId: 'tempura',
    ticks: 620,
    targetLockTick: null,
    releaseTick: 20,
    phases: [],
    summon: {
      kind: 'clone',
      atTick: 20,
      hp: 1,
      damage: 3,
      rehitTicks: 30,
      hitstun: 16,
      knockbackX: 90,
      box: { offsetX: -42, y: GROUND_Y - 135, width: 84, height: 135 },
      offsets: [-300, -230, -160, -90, 90, 160, 230, 300, 0],
    },
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

  /**
   * One companion that does not care where its owner is.
   *
   * It walks the opponent down and bites on its own clock, which makes it the
   * only lasting pressure in the game that its owner does not have to be standing
   * next to. Four hit points, so clearing it out is a real option and a real cost
   * — the frames spent killing it are frames not spent on the owner.
   */
  {
    fighterId: 'scared',
    ticks: 620,
    targetLockTick: null,
    releaseTick: 20,
    phases: [],
    summon: {
      kind: 'husky',
      atTick: 20,
      hp: 4,
      damage: 7,
      rehitTicks: 54,
      hitstun: 22,
      knockbackX: 150,
      box: { offsetX: -85, y: 330, width: 170, height: 280 },
      /**
       * The standoff is 100, not the upgraded build's 150.
       *
       * At 150 the husky stops with the opponent's hurtbox starting 98 pixels
       * away and swings a box that reaches 85 — it can never connect, ever, and
       * the companion is decoration with a health bar. 100 leaves a visible gap
       * and still lands, which is what the move is for.
       */
      chase: { speed: 5.2, standoff: 100, reach: 170 },
      spawnOffsetX: -220,
    },
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
