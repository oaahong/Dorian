import { ARENA_MAX_X, ARENA_MIN_X, GROUND_Y } from '../sim/constants';

/**
 * What each ultimate *looks* like, as a list of art beats over time.
 *
 * The companion to `ultimateTimelines.ts`. That file says where an ultimate hits
 * and when; this one says what is on screen while it does. They share a clock —
 * both are measured in ticks from the ultimate's first unfrozen tick, after the
 * cut-in — so a beat can be written next to the hitbox it belongs to and stay
 * next to it.
 *
 * **This is data, and the split from the drawing code is deliberate.** In the
 * upgraded build a timeline is a method where `if (p === 36)` both spawns a
 * Phaser image and, ten lines away, contributes a rectangle. Half of that cannot
 * cross into `sim`, and splitting it by hand every time is how the two halves
 * drift. So the geometry and the timing live here as plain values, the simulation
 * owns the boxes, and `src/render/UltimateStage.ts` is a shell that draws what it
 * is told. Adding a thirteenth fighter's ultimate is an entry in this table, not
 * a new class.
 *
 * ### Where the cells come from
 *
 * Every `cell` is a letter on that fighter's skill sheet, keyed as
 * `skill-<fighter>-<cell>`. The letters are positions in a grid, so what a letter
 * *means* differs per fighter; `audit/skill-assets/contact_sheets/` is the map,
 * and the comment above each script says what the beats actually show.
 *
 * ### Where this departs from the upgraded build
 *
 * The tick values are the upgraded build's, unchanged. Several of its *cell*
 * choices are not, because they are demonstrably wrong against the art: it
 * repeatedly hands a fighter's body an effect layer. `alien` is overridden with
 * `H`, a green explosion with no cat in it; `sauce` with `I`, a puddle on the
 * floor; `ya` with `G`, an empty crowd ring. Those are corrected here to the cell
 * that actually draws the character, and each correction is commented where it is
 * made. The intent — which beat lands when — is preserved exactly.
 */

/**
 * Where a beat's x origin is measured from.
 *
 * The distinction that matters is `lockedTarget` versus `opponent`, and it is the
 * same one the hitboxes make: a locked target is where they *were* when the move
 * committed, which is what makes alien's bombardment and salad's bowl dodgeable.
 * Drawing the warning somewhere other than where the box lands would be a lie.
 */
export type VisualAnchor =
  | 'owner'
  | 'opponent'
  | 'lockedTarget'
  | 'absolute'
  | 'screen';

/**
 * Extra behaviour a beat asks the renderer for.
 *
 * A closed set rather than a callback, because a callback would put drawing code
 * back into the data file — which is the thing this arrangement exists to
 * prevent. Five entries covers all twelve ultimates.
 */
export type VisualEffect =
  /** White camera flash as the beat lands. */
  | 'flash'
  /** Camera shake as the beat lands. */
  | 'shake'
  /** Tween from `y` down to the floor, for anything dropped from above. */
  | 'fallFromSky'
  /** A handful of copies at random offsets — debris, sparks, shell casings. */
  | 'scatter'
  /** Point the sprite at the locked target, for a projectile fired from an edge. */
  | 'rotateToTarget';

export interface VisualBeat {
  /** Tick it fires on, on the same clock as `UltimatePhase.from`. */
  atTick: number;
  /** A letter on the fighter's skill sheet: `I` becomes `skill-<fighter>-i`. */
  cell: string;
  anchor: VisualAnchor;
  /** Added to the anchor's x. For `absolute`, it *is* the x. */
  offsetX?: number;
  /** Screen y. Sprites are bottom-anchored, so this is where the feet go. */
  y?: number;
  /** Height in pixels the art is fitted to, whatever its source resolution. */
  height?: number;
  /** How long it stays before fading, in ticks. */
  lifeTicks?: number;
  depth?: number;
  /** Mirror with the owner's facing, for anything that has a direction. */
  flipToFacing?: boolean;
  fx?: VisualEffect;
  /**
   * Fire again every `everyTicks` until `untilTick`, at most `max` times.
   *
   * `max` is mandatory because each occurrence is a live display object. Two
   * scripts would otherwise grow with the timeline: ok's flurry and sauce's
   * rampage both repeat on a modulus.
   */
  repeat?: { everyTicks: number; untilTick: number; max: number };
}

export interface UltimateVisualScript {
  /**
   * The cell the owner's own body shows while the ultimate has hold of it.
   *
   * Replaces the generic pose-sheet ultimate frame, which is one drawing for a
   * move that runs two seconds. It lasts only as long as the `ULTIMATE` state —
   * tempura and scared hand control back on tick 20 and go straight back to their
   * ordinary poses while their companions carry on.
   */
  ownerCell: string;
  beats: readonly VisualBeat[];
}

const ARENA_CENTRE = (ARENA_MIN_X + ARENA_MAX_X) / 2;

/** Screen-filling finish, drawn where the fullscreen hitbox is. */
const finish = (atTick: number, cell: string, height = 620): VisualBeat => ({
  atTick, cell, anchor: 'screen', y: 620, height, lifeTicks: 34, depth: 28, fx: 'flash',
});

export const ULTIMATE_VISUALS: Record<string, UltimateVisualScript> = {
  /**
   * 逼逼逼動感光波 — a scan that finds you, then everything aimed at where you were.
   *
   * The beats follow the four hitboxes exactly: L's scan lines with the low sweep,
   * M's descending beams with the column, five O spheres converging for the
   * bombardment, and H's burst on the screen-wide finish.
   *
   * Owner shows `I` (the cat casting), not the upgraded build's `H`, which is an
   * explosion with no cat in it.
   */
  alien: {
    ownerCell: 'I',
    beats: [
      { atTick: 8, cell: 'J', anchor: 'owner', offsetX: 40, y: GROUND_Y, height: 180, lifeTicks: 40 },
      { atTick: 16, cell: 'K', anchor: 'lockedTarget', y: GROUND_Y, height: 210, lifeTicks: 46 },
      { atTick: 26, cell: 'L', anchor: 'screen', y: 600, height: 380, lifeTicks: 20, depth: 22 },
      { atTick: 36, cell: 'M', anchor: 'lockedTarget', y: GROUND_Y, height: 420, lifeTicks: 22 },
      { atTick: 44, cell: 'N', anchor: 'opponent', y: 420, height: 120, lifeTicks: 14,
        repeat: { everyTicks: 4, untilTick: 60, max: 5 } },
      { atTick: 66, cell: 'P', anchor: 'lockedTarget', y: GROUND_Y + 10, height: 130, lifeTicks: 30 },
      // Five spheres from the corners of the screen, each turned to face the spot
      // the move locked on to.
      { atTick: 70, cell: 'O', anchor: 'absolute', offsetX: 640, y: 120, height: 150, lifeTicks: 24, fx: 'rotateToTarget' },
      { atTick: 70, cell: 'O', anchor: 'absolute', offsetX: 160, y: 190, height: 150, lifeTicks: 24, fx: 'rotateToTarget' },
      { atTick: 70, cell: 'O', anchor: 'absolute', offsetX: 1120, y: 190, height: 150, lifeTicks: 24, fx: 'rotateToTarget' },
      { atTick: 71, cell: 'O', anchor: 'absolute', offsetX: 40, y: 430, height: 150, lifeTicks: 24, fx: 'rotateToTarget' },
      { atTick: 71, cell: 'O', anchor: 'absolute', offsetX: 1240, y: 430, height: 150, lifeTicks: 24, fx: 'rotateToTarget' },
      { atTick: 74, cell: 'N', anchor: 'lockedTarget', y: 460, height: 200, lifeTicks: 16, fx: 'shake' },
      finish(92, 'H', 700),
    ],
  },

  /**
   * 超級賽狗 — a transformation, so the beats are all about the moment of change.
   *
   * `I` is the golden silhouette the change happens inside; the upgraded build
   * used it as the transformed idle pose, which left doge standing still as an
   * explosion for eight seconds. It belongs here, on the peak, and the transformed
   * poses live in `installPoses.ts`.
   */
  doge: {
    ownerCell: 'H',
    beats: [
      { atTick: 12, cell: 'E', anchor: 'owner', y: GROUND_Y, height: 200, lifeTicks: 40, flipToFacing: true },
      { atTick: 30, cell: 'F', anchor: 'owner', y: GROUND_Y, height: 240, lifeTicks: 30, flipToFacing: true, fx: 'flash' },
      { atTick: 42, cell: 'I', anchor: 'owner', y: GROUND_Y + 20, height: 400, lifeTicks: 30 },
      finish(54, 'G', 560),
    ],
  },

  /**
   * 哈ㄗ咖西 — a photograph of the whole fight, then the photograph tearing.
   *
   * Owner shows `I` (the hamster holding a phone up), not `G`, which is the
   * awkward-crowd ring the charge special uses.
   */
  ya: {
    ownerCell: 'I',
    beats: [
      { atTick: 8, cell: 'H', anchor: 'opponent', y: GROUND_Y, height: 300, lifeTicks: 46 },
      // The flash of the shutter. Unused by the upgraded build, which fired the
      // camera's flash with no flash in it.
      { atTick: 14, cell: 'K', anchor: 'screen', y: 560, height: 420, lifeTicks: 12, fx: 'flash' },
      { atTick: 22, cell: 'J', anchor: 'screen', y: 640, height: 460, lifeTicks: 50, depth: 25 },
      { atTick: 36, cell: 'L', anchor: 'screen', offsetX: -30, y: 560, height: 400, lifeTicks: 30, fx: 'shake' },
      { atTick: 64, cell: 'M', anchor: 'screen', offsetX: -180, y: 520, height: 300, lifeTicks: 34 },
      { atTick: 64, cell: 'N', anchor: 'screen', offsetX: 180, y: 520, height: 300, lifeTicks: 34, fx: 'flash' },
    ],
  },

  /**
   * oh fucking 天婦羅尬哩涼！ — nine of him arrive and he goes back to fighting.
   *
   * The clones themselves are simulation entities drawn by `CombatView`; these
   * beats are the arrival. `P` — the pile of penguins, which the upgraded build
   * never drew — is what lands on the field a moment before they spread out.
   */
  tempura: {
    ownerCell: 'M',
    beats: [
      { atTick: 10, cell: 'H', anchor: 'owner', y: 430, height: 190, lifeTicks: 20, fx: 'shake' },
      { atTick: 20, cell: 'P', anchor: 'owner', y: GROUND_Y, height: 260, lifeTicks: 26, fx: 'flash' },
    ],
  },

  /**
   * 長老您保重 — ten years of an elder's life, spent on being handsome.
   *
   * `J` is a clock dissolving, which is the ten years going; `V` and `W` are the
   * heart burst and the glow, neither of which the upgraded build drew.
   */
  goblin: {
    ownerCell: 'I',
    beats: [
      { atTick: 10, cell: 'H', anchor: 'owner', y: GROUND_Y, height: 240, lifeTicks: 40 },
      { atTick: 22, cell: 'J', anchor: 'owner', offsetX: 60, y: 420, height: 200, lifeTicks: 34 },
      { atTick: 38, cell: 'K', anchor: 'owner', y: GROUND_Y + 10, height: 340, lifeTicks: 26, fx: 'flash' },
      { atTick: 45, cell: 'V', anchor: 'owner', y: 480, height: 260, lifeTicks: 30 },
      { atTick: 54, cell: 'W', anchor: 'owner', y: GROUND_Y + 26, height: 200, lifeTicks: 90, depth: 8 },
    ],
  },

  /**
   * 菜就多練 — an overhead you must stand-block, then a low you must not.
   *
   * The bowl is visible falling for forty ticks before it lands, which is what
   * makes the high/low readable rather than a coin toss. The four scatter layers
   * are the salad it was full of.
   */
  salad: {
    ownerCell: 'I',
    beats: [
      { atTick: 8, cell: 'K', anchor: 'lockedTarget', y: GROUND_Y - 10, height: 120, lifeTicks: 44, depth: 8 },
      { atTick: 30, cell: 'J', anchor: 'lockedTarget', y: 60, height: 300, lifeTicks: 30, fx: 'fallFromSky' },
      { atTick: 52, cell: 'H', anchor: 'lockedTarget', y: GROUND_Y, height: 220, lifeTicks: 16 },
      { atTick: 56, cell: 'L', anchor: 'lockedTarget', y: GROUND_Y, height: 330, lifeTicks: 26 },
      { atTick: 62, cell: 'M', anchor: 'lockedTarget', y: GROUND_Y, height: 300, lifeTicks: 30, fx: 'shake' },
      { atTick: 62, cell: 'N', anchor: 'lockedTarget', y: GROUND_Y, height: 320, lifeTicks: 30 },
      { atTick: 64, cell: 'O', anchor: 'lockedTarget', y: GROUND_Y + 8, height: 200, lifeTicks: 26 },
      // What was in the bowl, thrown outward. Four sheets so the debris is not one
      // repeated shape; capped so a long timeline cannot grow the object count.
      { atTick: 64, cell: 'L2', anchor: 'lockedTarget', y: 500, height: 150, lifeTicks: 34, fx: 'scatter' },
      { atTick: 65, cell: 'M2', anchor: 'lockedTarget', y: 520, height: 150, lifeTicks: 34, fx: 'scatter' },
      { atTick: 66, cell: 'N2', anchor: 'lockedTarget', y: 540, height: 140, lifeTicks: 34, fx: 'scatter' },
      { atTick: 66, cell: 'O2', anchor: 'lockedTarget', y: 480, height: 140, lifeTicks: 34, fx: 'scatter' },
      { atTick: 67, cell: 'P', anchor: 'lockedTarget', y: 460, height: 150, lifeTicks: 34, fx: 'scatter' },
    ],
  },

  /**
   * 喵蘇魯的召喚！ — four tentacles at fixed places, so where you stand decides how
   * many reach you.
   *
   * The tentacle beats sit on the same ticks and the same x positions as the four
   * hitboxes. Owner shows `H`, the cat holding its staff up — the upgraded build
   * used `F`, one of the charge special's magic circles.
   */
  wizard: {
    ownerCell: 'H',
    beats: [
      { atTick: 10, cell: 'I', anchor: 'absolute', offsetX: ARENA_CENTRE, y: GROUND_Y + 14, height: 240, lifeTicks: 60, depth: 8 },
      { atTick: 20, cell: 'J', anchor: 'absolute', offsetX: ARENA_CENTRE, y: GROUND_Y + 20, height: 220, lifeTicks: 70, depth: 9 },
      { atTick: 28, cell: 'K', anchor: 'absolute', offsetX: 270, y: GROUND_Y, height: 330, lifeTicks: 20 },
      { atTick: 38, cell: 'K', anchor: 'absolute', offsetX: 520, y: GROUND_Y, height: 330, lifeTicks: 20 },
      { atTick: 48, cell: 'P', anchor: 'absolute', offsetX: 770, y: GROUND_Y, height: 330, lifeTicks: 20 },
      { atTick: 58, cell: 'P', anchor: 'absolute', offsetX: 1020, y: GROUND_Y, height: 330, lifeTicks: 20 },
      { atTick: 66, cell: 'L', anchor: 'screen', y: 400, height: 260, lifeTicks: 40 },
      { atTick: 76, cell: 'M', anchor: 'screen', y: GROUND_Y, height: 420, lifeTicks: 44 },
      { atTick: 84, cell: 'N', anchor: 'opponent', y: 440, height: 220, lifeTicks: 20 },
      { atTick: 88, cell: 'O', anchor: 'opponent', y: 470, height: 260, lifeTicks: 24, fx: 'shake' },
      finish(94, 'Q', 660),
      { atTick: 112, cell: 'R', anchor: 'screen', y: 560, height: 420, lifeTicks: 30 },
    ],
  },

  /**
   * 汪爆氣流斬 — the shield goes, and both swords come out.
   *
   * The two swords themselves are mounted on the transformed body by
   * `installPoses.ts`; `K`, the cell they were split out of, is deliberately never
   * drawn — see the note there. `I`, the burst, is what the upgraded build left
   * unused.
   */
  blade: {
    ownerCell: 'J',
    beats: [
      { atTick: 12, cell: 'H', anchor: 'owner', offsetX: 60, y: 480, height: 240, lifeTicks: 34, flipToFacing: true },
      { atTick: 30, cell: 'E', anchor: 'owner', offsetX: -90, y: 470, height: 220, lifeTicks: 26, fx: 'flash' },
      { atTick: 42, cell: 'G', anchor: 'owner', offsetX: 90, y: 470, height: 240, lifeTicks: 26 },
      { atTick: 54, cell: 'I', anchor: 'owner', y: GROUND_Y + 10, height: 340, lifeTicks: 26, fx: 'shake' },
      { atTick: 58, cell: 'R', anchor: 'opponent', y: 540, height: 380, lifeTicks: 26 },
      finish(58, 'I', 520),
    ],
  },

  /**
   * 派甜心假面...露出 — the mask comes off.
   *
   * `V` is the burst it comes off in and `W` the aura left behind; the transformed
   * poses, including the two the upgraded build never reached, are in
   * `installPoses.ts`.
   */
  pink: {
    ownerCell: 'I',
    beats: [
      { atTick: 10, cell: 'J', anchor: 'owner', y: GROUND_Y, height: 280, lifeTicks: 30 },
      { atTick: 28, cell: 'K', anchor: 'owner', y: GROUND_Y + 20, height: 340, lifeTicks: 24, fx: 'flash' },
      { atTick: 40, cell: 'H', anchor: 'owner', y: GROUND_Y, height: 320, lifeTicks: 26 },
      { atTick: 48, cell: 'V', anchor: 'owner', y: GROUND_Y + 30, height: 380, lifeTicks: 30, fx: 'shake' },
      { atTick: 54, cell: 'W', anchor: 'owner', y: GROUND_Y + 24, height: 300, lifeTicks: 90, depth: 8 },
      finish(58, 'U', 420),
    ],
  },

  /**
   * 胡渣男！ — he is somewhere else every seven ticks, and then the bowl lands.
   *
   * Owner shows `J`, the dog losing it, rather than the upgraded build's `I` —
   * which is a puddle of sauce on the floor, and belongs on the floor, where the
   * blink beats leave it.
   */
  sauce: {
    ownerCell: 'J',
    beats: [
      { atTick: 11, cell: 'K', anchor: 'owner', y: GROUND_Y, height: 220, lifeTicks: 16, flipToFacing: true,
        repeat: { everyTicks: 7, untilTick: 64, max: 8 } },
      { atTick: 14, cell: 'I', anchor: 'owner', y: GROUND_Y + 6, height: 90, lifeTicks: 60, depth: 7,
        repeat: { everyTicks: 14, untilTick: 64, max: 4 } },
      { atTick: 22, cell: 'H', anchor: 'owner', y: GROUND_Y, height: 260, lifeTicks: 40, depth: 7,
        repeat: { everyTicks: 20, untilTick: 62, max: 3 } },
      // The bowl, dropped. The upgraded build dropped `M`, three puddles, which
      // arrive from the sky as a splash that has not happened yet.
      { atTick: 72, cell: 'N', anchor: 'opponent', y: 40, height: 300, lifeTicks: 30, fx: 'fallFromSky' },
      { atTick: 76, cell: 'L', anchor: 'opponent', y: 380, height: 200, lifeTicks: 26, fx: 'scatter' },
      { atTick: 88, cell: 'M', anchor: 'opponent', y: GROUND_Y + 6, height: 150, lifeTicks: 60, depth: 7 },
      { atTick: 88, cell: 'O', anchor: 'opponent', y: GROUND_Y + 10, height: 190, lifeTicks: 80, depth: 6, fx: 'shake' },
      finish(88, 'G', 460),
    ],
  },

  /**
   * 嗷嗷嗷嗷嗷！！ — the cat is not fighting; the cat brought a dog.
   *
   * The husky is a simulation entity with its own hit points, so its poses live
   * with `CombatView`. These beats are the arrival: the portal, the roar, and the
   * cat curling into a ball, which is `J` and which nothing drew before.
   */
  scared: {
    ownerCell: 'J',
    beats: [
      // The cat's terror trebling, a beat before anything arrives. Nothing drew
      // this cell before; it is the only one on the sheet that is the cat rather
      // than the dog it is about to be replaced by.
      { atTick: 4, cell: 'H', anchor: 'owner', y: GROUND_Y, height: 210, lifeTicks: 22 },
      { atTick: 10, cell: 'I', anchor: 'owner', offsetX: 150, y: 470, height: 200, lifeTicks: 24, flipToFacing: true },
      { atTick: 16, cell: 'K', anchor: 'owner', offsetX: -220, y: GROUND_Y, height: 300, lifeTicks: 30 },
      { atTick: 20, cell: 'V', anchor: 'owner', offsetX: -220, y: GROUND_Y, height: 280, lifeTicks: 34, fx: 'shake' },
      { atTick: 24, cell: 'U', anchor: 'owner', offsetX: -180, y: 480, height: 120, lifeTicks: 20 },
    ],
  },

  /**
   * 大哥你是了解我的 — he calls the brothers, they hold you, and then he does not
   * use his fists.
   *
   * The upgraded build stopped at three of the four minions and never drew the
   * gun going off. The whole sequence is here: rope, gun, muzzle flash, tracers,
   * impacts, and the explosion the last hit is.
   */
  ok: {
    ownerCell: 'I',
    beats: [
      { atTick: 12, cell: 'J', anchor: 'owner', offsetX: -170, y: GROUND_Y, height: 230, lifeTicks: 90 },
      { atTick: 12, cell: 'K', anchor: 'owner', offsetX: 170, y: GROUND_Y, height: 230, lifeTicks: 90, flipToFacing: true },
      { atTick: 16, cell: 'L', anchor: 'opponent', offsetX: -120, y: GROUND_Y, height: 220, lifeTicks: 86 },
      { atTick: 16, cell: 'M', anchor: 'opponent', offsetX: 120, y: GROUND_Y, height: 220, lifeTicks: 86, flipToFacing: true },
      // The rope. Without it the nine hits that follow land on somebody who is
      // simply standing there for no visible reason.
      { atTick: 20, cell: 'N', anchor: 'opponent', y: GROUND_Y - 10, height: 260, lifeTicks: 86, depth: 24 },
      { atTick: 38, cell: 'O', anchor: 'owner', y: GROUND_Y, height: 260, lifeTicks: 20 },
      { atTick: 44, cell: 'Q', anchor: 'owner', offsetX: 90, y: 460, height: 90, lifeTicks: 16, flipToFacing: true },
      { atTick: 46, cell: 'P', anchor: 'owner', y: GROUND_Y, height: 270, lifeTicks: 62 },
      { atTick: 48, cell: 'R', anchor: 'owner', offsetX: 130, y: 470, height: 120, lifeTicks: 8, flipToFacing: true,
        repeat: { everyTicks: 5, untilTick: 90, max: 9 } },
      { atTick: 49, cell: 'U', anchor: 'owner', offsetX: 220, y: 470, height: 110, lifeTicks: 10, flipToFacing: true,
        repeat: { everyTicks: 5, untilTick: 90, max: 9 } },
      { atTick: 50, cell: 'S', anchor: 'opponent', y: 470, height: 150, lifeTicks: 12,
        repeat: { everyTicks: 5, untilTick: 90, max: 9 } },
      { atTick: 104, cell: 'T', anchor: 'opponent', y: GROUND_Y + 20, height: 400, lifeTicks: 30, fx: 'shake' },
      finish(104, 'H', 520),
    ],
  },
};

export function ultimateVisualsFor(fighterId: string): UltimateVisualScript {
  const script = ULTIMATE_VISUALS[fighterId];
  if (!script) throw new Error(`No ultimate visuals for fighter: ${fighterId}`);
  return script;
}
