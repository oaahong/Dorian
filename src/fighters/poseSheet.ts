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

/** The poses the renderer knows how to ask for. */
export type PoseName =
  | 'idle' | 'walkForward' | 'walkBack' | 'jump' | 'crouch'
  | 'light' | 'heavy' | 'block' | 'hit' | 'special' | 'ultimate'
  | 'throw' | 'victory' | 'ko';

export const POSE_NAMES: readonly PoseName[] = [
  'idle', 'walkForward', 'walkBack', 'jump', 'crouch',
  'light', 'heavy', 'block', 'hit', 'special', 'ultimate',
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
  light: 8,
  heavy: 9,
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
  crouch: 7,
  light: 10,
  heavy: 11,
  block: 8,
  hit: 16,
  special: 24,
  ultimate: 28,
  throw: 22,
  victory: 21,
  ko: 20,
};

const LAYOUTS: Record<string, PoseNumbers> = { alien: ALIEN_LAYOUT };

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
