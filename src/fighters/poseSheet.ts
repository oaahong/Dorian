/**
 * Which numbered pose image stands for each of the game's poses.
 *
 * The eight original cards were cut apart at runtime: `SpriteExtractor` loaded a
 * 3 MB PNG per fighter, cropped thirteen panels out of it, flood-filled the black
 * backdrop and registered each result as a CanvasTexture. That work is now done
 * ahead of time by `scripts/extract_poses.py`, which writes
 * `public/assets/poses/<fighter>/01..30.png` with the background already removed.
 *
 * Doing it offline is strictly better: the cropping rectangles and the threshold
 * live next to the art they were tuned against, a bad crop is visible in a contact
 * sheet instead of on a moving fighter, and the client stops spending its first
 * frames on canvas passes. It also ends the long-running argument about the
 * near-black threshold eating pupils — the pipeline flood-fills from the crop
 * edge, so enclosed dark areas are never reached.
 *
 * Sheets are numbered, not named, so the mapping from a pose to a number lives
 * here. Eleven of the twelve sheets share one layout; `alien` was shot in a
 * different order and gets its own.
 */

import { SKILL_CELLS } from './skillCells';

/** The poses the renderer knows how to ask for. */
export type PoseName =
  | 'idle' | 'walkForward' | 'walkBack' | 'jump' | 'crouch'
  | 'dashForward' | 'dashBack'
  | 'light' | 'heavy' | 'crouchLight' | 'crouchHeavy' | 'jumpLight' | 'jumpHeavy'
  | 'block' | 'hit' | 'special' | 'ultimate'
  | 'throw' | 'victory' | 'ko';

export const POSE_NAMES: readonly PoseName[] = [
  'idle', 'walkForward', 'walkBack', 'jump', 'crouch',
  'dashForward', 'dashBack',
  'light', 'heavy', 'crouchLight', 'crouchHeavy', 'jumpLight', 'jumpHeavy',
  'block', 'hit', 'special', 'ultimate',
  'throw', 'victory', 'ko',
];

type PoseNumbers = Record<PoseName, number>;

/** Eleven of the twelve sheets. */
const STANDARD_LAYOUT: PoseNumbers = {
  idle: 1,
  walkForward: 2,
  walkBack: 3,
  crouch: 4,
  jump: 5,
  dashForward: 6,
  dashBack: 7,
  light: 8,
  heavy: 9,
  crouchLight: 10,
  crouchHeavy: 11,
  jumpLight: 12,
  jumpHeavy: 13,
  block: 14,
  hit: 16,
  special: 24,
  ultimate: 28,
  throw: 18,
  victory: 23,
  ko: 22,
};

/**
 * `alien` only. Its sheet runs jump and the dashes before the crouch, which
 * shifts everything after it, so the numbers cannot be shared.
 */
const ALIEN_LAYOUT: PoseNumbers = {
  idle: 1,
  walkForward: 2,
  walkBack: 3,
  jump: 4,
  dashForward: 5,
  dashBack: 6,
  crouch: 7,
  light: 10,
  heavy: 11,
  crouchLight: 12,
  crouchHeavy: 13,
  jumpLight: 14,
  jumpHeavy: 15,
  block: 8,
  hit: 16,
  special: 24,
  ultimate: 28,
  throw: 22,
  victory: 21,
  ko: 20,
};

const LAYOUTS: Record<string, PoseNumbers> = { alien: ALIEN_LAYOUT };

/**
 * The skill-sheet cells the chargeable special is drawn from.
 *
 * `A`, `B` and `C` are the three wind-up frames — the pipeline categorises them as
 * `H_CHARGE_FIGHTER` — and `D` is the release. They are separate from the numbered
 * pose sheet because they come from a different source sheet with a different
 * pipeline, so they are keyed and loaded separately rather than pretending to be
 * poses.
 */
const CHARGE_CELLS = ['A', 'B', 'C'] as const;
const RELEASE_CELL = 'D';

/**
 * The companion an ultimate leaves behind, for the two fighters that have one.
 *
 * Further into the same skill sheets than anything else the game loads, because
 * these cells are the only ones that are *characters in their own right* rather
 * than effects — tempura's penguin and scared's husky both stand on the field
 * and can be knocked down, so they need a body rather than a flash.
 */
const SUMMON_CELLS: Record<string, string> = { tempura: 'I', scared: 'L' };

export const summonTextureKey = (fighterId: string): string | null =>
  SUMMON_CELLS[fighterId] ? skillTextureKey(fighterId, SUMMON_CELLS[fighterId]!) : null;

const skillTextureKey = (fighterId: string, cell: string): string =>
  `skill-${fighterId}-${cell.toLowerCase()}`;

const skillPath = (fighterId: string, cell: string): string =>
  `assets/skills/${fighterId}/${cell}.png`;

/** The wind-up frame for a charge level, so the player can see what they have. */
export const chargeTextureKey = (fighterId: string, level: 1 | 2 | 3): string =>
  skillTextureKey(fighterId, CHARGE_CELLS[level - 1]!);

export const chargePath = (fighterId: string, level: 1 | 2 | 3): string =>
  skillPath(fighterId, CHARGE_CELLS[level - 1]!);

/** The release frame, shared with the ultimate cut-in's portrait. */
export const releaseTextureKey = (fighterId: string): string =>
  skillTextureKey(fighterId, RELEASE_CELL);

export const releasePath = (fighterId: string): string =>
  skillPath(fighterId, RELEASE_CELL);

/**
 * Every skill texture a match needs for one fighter, as key and path.
 *
 * The whole sheet, not a chosen few. This used to load four cells — the three
 * wind-up frames and the release — which is why 176 of the 226 images the asset
 * pipeline produces had never reached a browser: the ultimates' art, the charge
 * specials' beams and every transformed pose were on disk and unreachable.
 *
 * A fighter's sheet is about 1.4 MB, so a match loads under 3 MB for the two it
 * needs. That is the same order as the one cut-in background it already loads per
 * fighter, and it happens behind `PrepareMatchScene`'s progress bar, which exists
 * for exactly this.
 */
export function skillTexturesFor(fighterId: string): { key: string; path: string }[] {
  const cells = SKILL_CELLS[fighterId] ?? [...CHARGE_CELLS, RELEASE_CELL];
  return cells.map((cell) => ({
    key: skillTextureKey(fighterId, cell),
    path: skillPath(fighterId, cell),
  }));
}

export function poseNumber(fighterId: string, pose: PoseName): number {
  return (LAYOUTS[fighterId] ?? STANDARD_LAYOUT)[pose];
}

/** Texture key a pose is registered under. */
export function poseTextureKey(fighterId: string, pose: PoseName): string {
  return `pose-${fighterId}-${pose}`;
}

/** Path the pose image is served from, relative to the site root. */
export function posePath(fighterId: string, pose: PoseName): string {
  const number = String(poseNumber(fighterId, pose)).padStart(2, '0');
  return `assets/poses/${fighterId}/${number}.png`;
}
